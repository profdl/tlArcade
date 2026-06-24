/**
 * THE REFEREE  (SPEC §3)
 * ======================
 * The server-authoritative arbiter that lives inside the room's Durable Object.
 * It is the ONLY actor allowed to perform operations whose correctness depends
 * on information clients must not have:
 *   • fair dice rolls       (a client could otherwise re-roll until happy)
 *   • hidden shuffles       (order must be unknowable to everyone, incl. shuffler)
 *   • secret reveals        (face-down values, owner-only hands)
 *
 * It also owns IDENTITY: seats (durable game roles) backed by either a
 * logged-in user or a guest secret (§3.7). Ownership is always a SeatId.
 *
 * This class is deliberately framework-free: it talks to the room through the
 * small `RoomBridge` interface below, so it can be unit-tested without
 * Cloudflare. `TldrawDurableObject` supplies the real bridge.
 *
 * STATUS: Phase-2 skeleton. `claimSeat` and `roll` are implemented end-to-end;
 * `shuffle`/`draw`/`flip`/`reveal` are stubbed with the correct shape and TODOs
 * pointing at SPEC sections (built in Phases 3–5).
 */
import type {
	IdentityProof,
	RefereeRequest,
	RefereeResponse,
	SeatId,
	SessionId,
} from '../shared/referee-protocol'

/** The minimal surface the referee needs from the sync room. */
export interface RoomBridge {
	/** Authoritatively mutate the shared store (e.g. write a die's new value). */
	updateStore(fn: (store: StoreTxn) => void): Promise<void> | void
	/** Read a record by id (e.g. the current die shape). */
	getRecord(id: string): { id: string; type?: string; props?: Record<string, unknown> } | undefined
	/** Send a private message to one session — the channel for owner-only reveals. */
	sendToSession(sessionId: SessionId, data: unknown): void
}

/** Subset of the room store-transaction API the referee uses. */
export interface StoreTxn {
	get(id: string): any
	put(record: any): void
	delete(id: string): void
}

interface Seat {
	identity: IdentityProof
	activeSessions: Set<SessionId>
}

export class Referee {
	private readonly seats = new Map<SeatId, Seat>()
	/** Idempotency: requestIds we've already processed (§3.6). */
	private readonly handledRequests = new Set<string>()

	private readonly room: RoomBridge
	constructor(room: RoomBridge) {
		this.room = room
	}

	// ── ENTRY POINT ────────────────────────────────────────────────────────────
	async handleRequest(
		sessionId: SessionId,
		requestId: string,
		req: RefereeRequest
	): Promise<RefereeResponse> {
		// Idempotent: replays of the same requestId are no-ops that report success.
		if (this.handledRequests.has(requestId)) {
			return { kind: 'referee', requestId, ok: true }
		}

		try {
			switch (req.action) {
				case 'claimSeat':
					return await this.claimSeat(sessionId, requestId, req.seatId, req.identity)
				case 'roll':
					return await this.roll(requestId, req.dieId)
				case 'shuffle':
				case 'draw':
				case 'drawRandom':
				case 'flip':
				case 'reveal':
					// Phases 3–5 (SPEC §3.3, §5.2, §5.5). Shape is defined; logic pending.
					return this.notImplemented(requestId, req.action)
				default:
					return this.fail(requestId, `Unknown action`)
			}
		} catch (e) {
			return this.fail(requestId, e instanceof Error ? e.message : 'Referee error')
		}
	}

	// ── SEATS / IDENTITY (§3.7) ──────────────────────────────────────────────────
	private async claimSeat(
		sessionId: SessionId,
		requestId: string,
		seatId: SeatId,
		identity: IdentityProof
	): Promise<RefereeResponse> {
		// TODO(Phase 3+): verify the IdentityProof. For a 'user' proof, validate the
		// token against your auth (JWT signature / session lookup). For a 'guest'
		// proof, check the (guestId, secret) pair. For now we accept any well-formed
		// proof so the seat plumbing is exercisable end-to-end.
		const existing = this.seats.get(seatId)
		if (existing && !identitiesMatch(existing.identity, identity)) {
			return this.fail(requestId, 'Seat already taken by another player')
		}
		const seat = existing ?? { identity, activeSessions: new Set<SessionId>() }
		seat.identity = identity // allow guest→user upgrade (§3.7): same holder swaps proof
		seat.activeSessions.add(sessionId)
		this.seats.set(seatId, seat)

		this.handledRequests.add(requestId)
		// TODO(Phase 5): replay this seat's private state (owner-only hand contents).
		return { kind: 'referee', requestId, ok: true, result: { type: 'seatClaimed', seatId } }
	}

	/** Forget a session when its socket closes (called by the DO). */
	dropSession(sessionId: SessionId) {
		for (const seat of this.seats.values()) seat.activeSessions.delete(sessionId)
	}

	// ── DICE (§5.3) ──────────────────────────────────────────────────────────────
	private async roll(requestId: string, dieId: string): Promise<RefereeResponse> {
		const die = this.room.getRecord(dieId)
		if (!die || die.type !== 'die') {
			return this.fail(requestId, `No die ${dieId}`)
		}
		// Determine face count from the die's props (skeleton supports a `faceCount`).
		const faceCount = numberProp(die.props?.faceCount, 6)
		const value = this.rollFair(faceCount) // 0..faceCount-1

		await this.room.updateStore((store) => {
			const current = store.get(dieId)
			if (current) store.put({ ...current, props: { ...current.props, value, rolling: false } })
		})

		this.handledRequests.add(requestId)
		return { kind: 'referee', requestId, ok: true, result: { type: 'rolled', dieId, value } }
	}

	/** Fair RNG over [0, n). Uses the platform CSPRNG (§3.5). */
	private rollFair(n: number): number {
		if (n <= 1) return 0
		// Rejection sampling for an unbiased result across the range.
		const limit = Math.floor(0x100000000 / n) * n
		const buf = new Uint32Array(1)
		let x: number
		do {
			crypto.getRandomValues(buf)
			x = buf[0]
		} while (x >= limit)
		return x % n
	}

	// ── helpers ──────────────────────────────────────────────────────────────────
	private notImplemented(requestId: string, action: string): RefereeResponse {
		return this.fail(requestId, `Action '${action}' not implemented yet (see SPEC §3.3)`)
	}
	private fail(requestId: string, error: string): RefereeResponse {
		return { kind: 'referee', requestId, ok: false, error }
	}
}

function identitiesMatch(a: IdentityProof, b: IdentityProof): boolean {
	if (a.kind === 'guest' && b.kind === 'guest') return a.guestId === b.guestId
	if (a.kind === 'user' && b.kind === 'user') return a.token === b.token
	// A guest holding the seat may upgrade to a user (handled by caller); other
	// cross-kind combinations are treated as "same holder" only at the call site.
	return a.kind === b.kind
}

function numberProp(v: unknown, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
