import {
	DurableObjectSqliteSyncWrapper,
	type SessionStateSnapshot,
	SQLiteSyncStorage,
	TLSocketRoom,
} from '@tldraw/sync-core'
import type { TLRecord } from '@tldraw/tlschema'
import { createTLSchema, defaultBindingSchemas, defaultShapeSchemas } from '@tldraw/tlschema'
import { DurableObject } from 'cloudflare:workers'
import type { IRequest } from 'itty-router'
import { AutoRouter, error } from 'itty-router'

// The ant-mover room. Like the Toolkit DO it hosts a synced tldraw document
// (the authored maze + which shape is the object — see the plan's native-first
// section), so we keep tldraw's BUILT-IN shapes only (no custom game shapes yet):
// the maze/object are native geo/draw/line shapes. Defaults on BOTH sides
// (client useSync + here) or the sync handshake rejects with CLIENT_TOO_OLD.
const schema = createTLSchema({
	shapes: { ...defaultShapeSchemas },
	bindings: { ...defaultBindingSchemas },
})

// UNLIKE the Toolkit DO, this one runs a SERVER TICK LOOP: an alarm()-armed
// fixed-tick that steps a sim (dummy in step 3, planck from step 4) and
// broadcasts a pose. The Toolkit is purely event-driven and has no loop to copy,
// so the alarm pattern is built from scratch here. See the
// tlarcade-do-realtime-sim skill.

/** ~30 Hz tick. */
const TICK_MS = 33

/** Two kinds of socket land on this DO, distinguished by their attachment.
 *  - 'sync'  : the tldraw sync socket (owned by TLSocketRoom).
 *  - 'input' : the dedicated upstream channel carrying {anchor, cursor} — the
 *    sync socket can't carry client→server custom data (see the skill), so grabs
 *    ride this second socket. TLSocketRoom never sees it (no framing conflict). */
interface SyncAttachment {
	kind: 'sync'
	sessionId: string
	snapshot: SessionStateSnapshot | null
}
interface InputAttachment {
	kind: 'input'
	sessionId: string
}
type SocketAttachment = SyncAttachment | InputAttachment

/** A player's latest grab input (dummy shape in step 3). */
interface Grab {
	anchor: { x: number; y: number }
	cursor: { x: number; y: number }
}

export class AntMoverDurableObject extends DurableObject {
	private room: TLSocketRoom<TLRecord, void> | null = null
	/** sessionId → sync ws, for addressing pose broadcasts. */
	private readonly syncSockets = new Map<string, WebSocket>()
	/** sessionId → the latest grab from that player's input socket. */
	private readonly grabs = new Map<string, Grab>()
	/** Whether the alarm tick loop is currently armed (so we arm exactly once). */
	private ticking = false

	// --- Dummy sim state (step 3). Replaced by planck in step 4. A point that
	// drifts toward the average of all players' cursors, so input visibly drives
	// the broadcast pose. ---
	private pose = { x: 400, y: 400, angle: 0 }

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		// Answer the sync client's 5s ping at the platform level without waking the
		// DO (same as the Toolkit DO).
		this.ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}')
		)
	}

	private getOrCreateRoom(): TLSocketRoom<TLRecord, void> {
		if (!this.room) {
			const sql = new DurableObjectSqliteSyncWrapper(this.ctx.storage)
			const storage = new SQLiteSyncStorage<TLRecord>({ sql })
			this.room = new TLSocketRoom<TLRecord, void>({
				schema,
				storage,
				clientTimeout: Infinity,
				onSessionSnapshot: (sessionId, snapshot) => {
					const ws = this.syncSockets.get(sessionId)
					if (ws) ws.serializeAttachment({ kind: 'sync', sessionId, snapshot })
				},
			})
			// Resume any SYNC sessions that survived hibernation. Input sockets carry
			// no room session — they're re-registered from their attachment below.
			for (const ws of this.ctx.getWebSockets()) {
				const att = ws.deserializeAttachment() as SocketAttachment | null
				if (!att) continue
				if (att.kind === 'sync') {
					this.syncSockets.set(att.sessionId, ws)
					if (att.snapshot) {
						this.room.handleSocketResume({
							sessionId: att.sessionId,
							socket: ws,
							snapshot: att.snapshot,
						})
					}
				} else {
					// Input socket survived hibernation: nothing to resume in the room,
					// but keep a live grab slot so this player's pulls still land.
					if (!this.grabs.has(att.sessionId)) {
						this.grabs.set(att.sessionId, {
							anchor: { x: 0, y: 0 },
							cursor: { x: this.pose.x, y: this.pose.y },
						})
					}
				}
			}
		}
		return this.room
	}

	private readonly router = AutoRouter({ catch: (e) => error(e) })
		// The tldraw SYNC socket (document sync + presence + pose-down channel).
		.get('/api/am/connect/:roomId', (request) => this.handleSyncConnect(request))
		// The dedicated INPUT socket (grabs up). Same DO, different socket.
		.get('/api/am/input/:roomId', (request) => this.handleInputConnect(request))

	fetch(request: Request): Response | Promise<Response> {
		return this.router.fetch(request)
	}

	// --- Sync socket (mirrors the Toolkit DO) ---------------------------------

	async handleSyncConnect(request: IRequest) {
		const sessionId = request.query.sessionId as string
		if (!sessionId) return error(400, 'Missing sessionId')
		const { 0: client, 1: server } = new WebSocketPair()
		this.ctx.acceptWebSocket(server)
		server.serializeAttachment({ kind: 'sync', sessionId, snapshot: null } satisfies SyncAttachment)
		this.syncSockets.set(sessionId, server)
		this.getOrCreateRoom().handleSocketConnect({ sessionId, socket: server })
		this.ensureTicking()
		return new Response(null, { status: 101, webSocket: client })
	}

	// --- Input socket (the upstream channel the sync socket can't provide) -----

	async handleInputConnect(request: IRequest) {
		const sessionId = request.query.sessionId as string
		if (!sessionId) return error(400, 'Missing sessionId')
		const { 0: client, 1: server } = new WebSocketPair()
		this.ctx.acceptWebSocket(server)
		server.serializeAttachment({ kind: 'input', sessionId } satisfies InputAttachment)
		// Seed an empty grab so the player exists in the sim even before first input.
		this.grabs.set(sessionId, { anchor: { x: 0, y: 0 }, cursor: { x: this.pose.x, y: this.pose.y } })
		this.ensureTicking()
		return new Response(null, { status: 101, webSocket: client })
	}

	// --- Hibernation socket handlers ------------------------------------------

	override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		const att = ws.deserializeAttachment() as SocketAttachment | null
		if (!att) return
		if (att.kind === 'sync') {
			// Normal tldraw sync traffic — hand to the room.
			this.syncSockets.set(att.sessionId, ws)
			this.getOrCreateRoom().handleSocketMessage(att.sessionId, message)
			return
		}
		// Input socket: a JSON {anchor, cursor} grab (or null to release). NOT
		// tldraw sync framing — the room never sees this socket.
		try {
			const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
			const data = JSON.parse(text) as Grab | { release: true }
			if ('release' in data) this.grabs.delete(att.sessionId)
			else this.grabs.set(att.sessionId, data)
		} catch {
			// Ignore malformed input frames.
		}
	}

	override async webSocketClose(ws: WebSocket) {
		this.endSocket(ws)
	}
	override async webSocketError(ws: WebSocket) {
		this.endSocket(ws)
	}

	private endSocket(ws: WebSocket) {
		const att = ws.deserializeAttachment() as SocketAttachment | null
		if (!att) return
		if (att.kind === 'sync') {
			this.syncSockets.delete(att.sessionId)
			const room = this.getOrCreateRoom()
			if (!room.getSessionSnapshot(att.sessionId)) {
				// Was hibernating; resume briefly so presence removal broadcasts.
				const a = att as SyncAttachment
				if (a.snapshot) {
					room.handleSocketResume({ sessionId: att.sessionId, socket: ws, snapshot: a.snapshot })
				}
			}
			room.handleSocketClose(att.sessionId)
		} else {
			this.grabs.delete(att.sessionId)
		}
		this.maybeStopTicking()
	}

	// --- The alarm-driven tick loop -------------------------------------------

	/** Arm the tick loop if it isn't already. Called whenever a player connects. */
	private ensureTicking() {
		if (this.ticking) return
		this.ticking = true
		this.ctx.storage.setAlarm(Date.now() + TICK_MS)
	}

	/** Stop the loop when the room has emptied — a self-re-arming 30 Hz alarm on an
	 * empty room would tick (and bill) forever. Re-armed on the next connect. */
	private maybeStopTicking() {
		if (this.hasPlayers()) return
		this.ticking = false
		this.ctx.storage.deleteAlarm()
	}

	private hasPlayers(): boolean {
		return this.syncSockets.size > 0 || this.grabs.size > 0
	}

	override async alarm() {
		// Re-hydrate maps after a hibernation wake (constructor + this alarm may run
		// on a fresh instance) by touching the room, which re-registers sockets.
		this.getOrCreateRoom()
		if (!this.hasPlayers()) {
			this.ticking = false
			return // room emptied while we slept; don't re-arm.
		}

		this.stepDummySim()
		this.broadcastPose()

		// Re-arm for the next tick.
		this.ctx.storage.setAlarm(Date.now() + TICK_MS)
	}

	/** Step 3 placeholder sim: ease the pose toward the average of all cursors, so
	 * input demonstrably drives the broadcast. Replaced by planck in step 4. */
	private stepDummySim() {
		const grabs = [...this.grabs.values()]
		if (grabs.length === 0) return
		let cx = 0
		let cy = 0
		for (const g of grabs) {
			cx += g.cursor.x
			cy += g.cursor.y
		}
		cx /= grabs.length
		cy /= grabs.length
		// Ease 15% toward the target each tick; spin slowly so rotation is visible.
		this.pose.x += (cx - this.pose.x) * 0.15
		this.pose.y += (cy - this.pose.y) * 0.15
		this.pose.angle += 0.02
	}

	/** Push the current pose to every sync socket via the room's custom-message
	 * channel (server→client — the only correct out-of-band downstream path). */
	private broadcastPose() {
		const room = this.getOrCreateRoom()
		const msg = { type: 'am-pose', pose: this.pose }
		for (const sessionId of this.syncSockets.keys()) {
			room.sendCustomMessage(sessionId, msg)
		}
	}
}
