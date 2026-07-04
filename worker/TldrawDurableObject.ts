import {
	DurableObjectSqliteSyncWrapper,
	type SessionStateSnapshot,
	SQLiteSyncStorage,
	TLSocketRoom,
} from '@tldraw/sync-core'
import type {
	TLRecord} from '@tldraw/tlschema';
import {
	createTLSchema,
	defaultBindingSchemas,
	defaultShapeSchemas
} from '@tldraw/tlschema'
import { DurableObject } from 'cloudflare:workers'
import type { IRequest } from 'itty-router';
import { AutoRouter, error } from 'itty-router'
import { gameBindingSchemas, gameShapeSchemas } from '../shared/shape-schemas'
import type { RefereeEnvelope } from '../shared/referee-protocol';
import { isRefereeEnvelope } from '../shared/referee-protocol'
import { Referee } from './Referee'

// The server's schema MUST match the client's EXACTLY, or the sync handshake
// rejects clients with CLIENT_TOO_OLD (mismatched migrations). This toolkit keeps
// tldraw's BUILT-IN shapes (geo/draw/arrow/text/note…) alongside the game shapes,
// so we register BOTH the defaults AND our custom schemas here — and the client
// must mirror this by passing `defaultShapeUtils`+`gameShapeUtils` to useSync
// (see client/shapes/registry.ts). Keep the two in lockstep: any default you
// include here must be included on the client, and vice-versa.
const schema = createTLSchema({
	shapes: { ...defaultShapeSchemas, ...gameShapeSchemas },
	bindings: { ...defaultBindingSchemas, ...gameBindingSchemas },
})

interface SocketAttachment {
	sessionId: string
	snapshot: SessionStateSnapshot | null
}

// Each whiteboard room is hosted in a Durable Object with WebSocket Hibernation.
// https://developers.cloudflare.com/durable-objects/
//
// There's only ever one durable object instance per room. Room state is
// persisted automatically to SQLite via ctx.storage. When all clients are
// idle, the DO hibernates (freeing memory) while WebSocket connections
// stay alive at the Cloudflare layer.
export class TldrawDurableObject extends DurableObject {
	private room: TLSocketRoom<TLRecord, void> | null = null
	/** Map sessionId → ws so onSessionSnapshot can serialize to the right socket. */
	private readonly sessionIdToWs = new Map<string, WebSocket>()
	/** The server-authoritative referee for this room (SPEC §3). Lazily created. */
	private referee: Referee | null = null

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		// Respond to ping messages at the platform level without waking the DO.
		// The TLSyncClient sends {"type":"ping"} every 5s; without this, each
		// ping would wake the DO from hibernation.
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
				// Disable idle timeout since Cloudflare handles keep-alive via auto-response.
				// Without this, sessions would be pruned after 20s of no "real" messages
				// even though the client is still connected and being auto-ponged.
				clientTimeout: Infinity,
				onSessionSnapshot: (sessionId, snapshot) => {
					const ws = this.sessionIdToWs.get(sessionId)
					if (ws) ws.serializeAttachment({ sessionId, snapshot })
				},
			})

			// Resume any sessions that survived hibernation
			for (const ws of this.ctx.getWebSockets()) {
				const attachment = ws.deserializeAttachment() as SocketAttachment | null
				if (!attachment?.sessionId) continue

				if (attachment.snapshot) {
					this.room.handleSocketResume({
						sessionId: attachment.sessionId,
						socket: ws,
						snapshot: attachment.snapshot,
					})
				}
			}
		}
		return this.room
	}

	// Build the referee on first use, bridging it to this room's store + sockets
	// (SPEC §3.1–§3.4). The bridge is the only coupling between the framework-free
	// Referee class and the Cloudflare/TLSocketRoom machinery.
	private getReferee(): Referee {
		if (!this.referee) {
			const room = this.getOrCreateRoom()
			this.referee = new Referee({
				updateStore: (fn) => room.updateStore(fn as never),
				getRecord: (id) => room.getRecord(id as never) as never,
				sendToSession: (sessionId, data) => room.sendCustomMessage(sessionId, data as never),
			})
		}
		return this.referee
	}

	private readonly router = AutoRouter({ catch: (e) => error(e) })
		.get('/api/connect/:roomId', (request) => this.handleConnect(request))
		// Referee RPCs come in over HTTP, not the sync socket: the sync socket is
		// one-way for custom messages (server→client only). Results are written to
		// the store (public) or pushed via sendCustomMessage (private). See SPEC §3.2.
		.post('/api/referee/:roomId', (request) => this.handleReferee(request))

	private async handleReferee(request: IRequest) {
		const envelope = (await request.json()) as RefereeEnvelope & { sessionId?: string }
		if (!isRefereeEnvelope(envelope) || !envelope.sessionId) {
			return error(400, 'Bad referee envelope')
		}
		const response = await this.getReferee().handleRequest(
			envelope.sessionId as never,
			envelope.requestId,
			envelope.request
		)
		return new Response(JSON.stringify(response), {
			headers: { 'content-type': 'application/json' },
		})
	}

	// Entry point for all requests to the Durable Object
	fetch(request: Request): Response | Promise<Response> {
		return this.router.fetch(request)
	}

	// Handle new WebSocket connection requests
	async handleConnect(request: IRequest) {
		const sessionId = request.query.sessionId as string
		if (!sessionId) return error(400, 'Missing sessionId')

		// Create the websocket pair for the client
		const { 0: clientWebSocket, 1: serverWebSocket } = new WebSocketPair()
		// Use hibernation API instead of serverWebSocket.accept()
		this.ctx.acceptWebSocket(serverWebSocket)

		// Store sessionId in attachment immediately so we can identify this socket
		// after hibernation, before the connect handshake completes.
		const attachment: SocketAttachment = { sessionId, snapshot: null }
		serverWebSocket.serializeAttachment(attachment)

		// Connect to the room. The first webSocketMessage from the client will
		// complete the handshake and trigger debounced snapshot storage.
		this.getOrCreateRoom().handleSocketConnect({ sessionId, socket: serverWebSocket })

		return new Response(null, { status: 101, webSocket: clientWebSocket })
	}

	// --- WebSocket Hibernation API handlers ---

	private getSessionId(ws: WebSocket): string | null {
		const attachment = ws.deserializeAttachment() as SocketAttachment | null
		return attachment?.sessionId ?? null
	}

	override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		const sessionId = this.getSessionId(ws)
		if (!sessionId) return

		this.sessionIdToWs.set(sessionId, ws)
		// Referee RPCs arrive over HTTP (see handleReferee), not here — this is
		// only the normal sync message path.
		this.getOrCreateRoom().handleSocketMessage(sessionId, message)
	}

	override async webSocketClose(ws: WebSocket) {
		this.handleWebSocketEnd(ws, 'handleSocketClose')
	}

	override async webSocketError(ws: WebSocket) {
		this.handleWebSocketEnd(ws, 'handleSocketError')
	}

	private handleWebSocketEnd(ws: WebSocket, method: 'handleSocketClose' | 'handleSocketError') {
		const attachment = ws.deserializeAttachment() as SocketAttachment | null
		if (!attachment?.sessionId) return

		this.sessionIdToWs.delete(attachment.sessionId)
		// Let the referee forget this session's seat occupancy (SPEC §3.6, §3.7).
		this.referee?.dropSession(attachment.sessionId as never)

		const room = this.getOrCreateRoom()

		// If the DO was hibernating, this session was never re-added to the room
		// (ctx.getWebSockets() doesn't include the disconnecting socket). Resume it
		// briefly so the room can broadcast presence removal to other clients.
		if (attachment.snapshot && !room.getSessionSnapshot(attachment.sessionId)) {
			room.handleSocketResume({
				sessionId: attachment.sessionId,
				socket: ws,
				snapshot: attachment.snapshot,
			})
		}

		room[method](attachment.sessionId)
	}
}
