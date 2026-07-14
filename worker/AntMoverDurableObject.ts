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
import {
	createWorld,
	step,
	objPose,
	grabAnchorPage,
	type Sim,
	type Grab as SimGrab,
} from '../src/demos/ant-mover/game/sim'
import type { WorldSpec } from '../src/demos/ant-mover/game/shapes'
import type { InputMsg, ServerMsg, RopeMsg } from '../src/demos/ant-mover/game/protocol'

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
// fixed-tick that steps the planck sim (game/sim.ts, imported verbatim — it's pure
// and framework-free precisely so it runs here) and broadcasts the pose. The
// Toolkit is purely event-driven and has no loop to copy, so the alarm pattern is
// built from scratch here. See the tlarcade-do-realtime-sim skill.

/** ~30 Hz tick. */
const TICK_MS = 33

/** Two kinds of socket land on this DO, distinguished by their attachment.
 *  - 'sync'  : the tldraw sync socket (owned by TLSocketRoom).
 *  - 'input' : the dedicated upstream channel carrying InputMsg — the sync socket
 *    can't carry client→server custom data (see the skill), so grabs + start/stop
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

export class AntMoverDurableObject extends DurableObject {
	private room: TLSocketRoom<TLRecord, void> | null = null
	/** sessionId → sync ws, for addressing pose broadcasts. */
	private readonly syncSockets = new Map<string, WebSocket>()
	/** sessionId → the latest grab from that player's input socket. Absent when the
	 *  player isn't currently holding the object. Shape matches sim.ts's Grab. */
	private readonly grabs = new Map<string, SimGrab>()
	/** sessionId of every connected input socket (whether or not currently holding),
	 *  so an input-only client still keeps the room alive + the loop armed. */
	private readonly inputSessions = new Set<string>()
	/** Whether the alarm tick loop is currently armed (so we arm exactly once). */
	private ticking = false

	// --- The live run. `sim` is null in author mode (stopped); non-null while a run
	// is active (created from the WorldSpec the starting client shipped up). ---
	private sim: Sim | null = null

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
					// Input socket survived hibernation: no room session to resume, but
					// keep it counted so the room stays alive and the loop stays armed.
					this.inputSessions.add(att.sessionId)
				}
			}
		}
		return this.room
	}

	private readonly router = AutoRouter({ catch: (e) => error(e) })
		// The tldraw SYNC socket (document sync + presence + pose-down channel).
		.get('/api/am/connect/:roomId', (request) => this.handleSyncConnect(request))
		// The dedicated INPUT socket (grabs + start/stop up). Same DO, different socket.
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
		// A late joiner gets the current run state so they enter sim-mode too.
		this.sendPlayState(sessionId)
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
		this.inputSessions.add(sessionId)
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
		// Input socket: an InputMsg (JSON). NOT tldraw sync framing — the room never
		// sees this socket.
		this.inputSessions.add(att.sessionId)
		try {
			const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
			const msg = JSON.parse(text) as InputMsg
			this.handleInput(att.sessionId, msg)
		} catch {
			// Ignore malformed input frames.
		}
	}

	/** Apply one InputMsg from a player. */
	private handleInput(sessionId: string, msg: InputMsg) {
		switch (msg.type) {
			case 'grab':
				// The client sends the body-local anchor (planck meters) — store it as
				// sim.ts's Grab (anchorLocal + cursor). Forces from every held grab sum.
				this.grabs.set(sessionId, {
					anchorLocal: { x: msg.anchor.x, y: msg.anchor.y },
					cursor: { x: msg.cursor.x, y: msg.cursor.y },
				})
				break
			case 'release':
				this.grabs.delete(sessionId)
				break
			case 'start':
				this.startRun(msg.spec)
				break
			case 'stop':
				this.stopRun()
				break
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
			// Input socket gone: drop this player's grab and stop counting them.
			this.grabs.delete(att.sessionId)
			this.inputSessions.delete(att.sessionId)
		}
		this.maybeStopTicking()
	}

	// --- Run lifecycle --------------------------------------------------------

	/** Start a run from the WorldSpec the pressing client computed (it has an editor;
	 *  the DO doesn't). createWorld builds the static maze + dynamic object. If the
	 *  spec has no usable object the run doesn't start. Broadcasts play-state so all
	 *  clients enter sim-mode with the object's local shape to draw. */
	private startRun(spec: WorldSpec) {
		const sim = createWorld(spec)
		if (!sim) return
		this.sim = sim
		this.grabs.clear()
		this.ensureTicking()
		this.broadcastPlayState()
	}

	/** Stop the run: drop the sim + grabs, back to author mode. Broadcasts stop. */
	private stopRun() {
		this.sim = null
		this.grabs.clear()
		this.broadcastPlayState()
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
		return this.syncSockets.size > 0 || this.inputSessions.size > 0
	}

	override async alarm() {
		// Re-hydrate maps after a hibernation wake (constructor + this alarm may run
		// on a fresh instance) by touching the room, which re-registers sockets.
		this.getOrCreateRoom()
		if (!this.hasPlayers()) {
			this.ticking = false
			return // room emptied while we slept; don't re-arm.
		}

		if (this.sim) {
			step(this.sim, this.grabs.values())
			this.broadcastPose()
		}

		// Re-arm for the next tick.
		this.ctx.storage.setAlarm(Date.now() + TICK_MS)
	}

	// --- Broadcast (server→client, the one correct out-of-band downstream path) --

	private send(sessionId: string, msg: ServerMsg) {
		this.getOrCreateRoom().sendCustomMessage(sessionId, msg)
	}

	/** Push the live pose + every active rope to every sync socket. */
	private broadcastPose() {
		const sim = this.sim
		if (!sim) return
		const ropes: RopeMsg[] = []
		for (const [sessionId, grab] of this.grabs) {
			ropes.push({ sessionId, anchor: grabAnchorPage(sim, grab), cursor: grab.cursor })
		}
		const msg: ServerMsg = { type: 'am-pose', pose: objPose(sim), ropes }
		for (const sessionId of this.syncSockets.keys()) this.send(sessionId, msg)
	}

	/** Broadcast the current play-state (+ the object's local shape on start) to all
	 *  sync sockets, so every client enters/leaves sim-mode together. */
	private broadcastPlayState() {
		for (const sessionId of this.syncSockets.keys()) this.sendPlayState(sessionId)
	}

	/** Send the current play-state to one session (used for late joiners too). */
	private sendPlayState(sessionId: string) {
		const shape = this.sim ? this.sim.shape : null
		this.send(sessionId, { type: 'am-play', playing: this.sim !== null, shape })
	}
}
