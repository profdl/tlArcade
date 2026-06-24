/**
 * REFEREE PROTOCOL  (SPEC §3.2, §3.3, §3.7)
 * =========================================
 * The wire contract between clients and the server-authoritative REFEREE.
 * Imported by BOTH the client (to send requests) and the worker (to handle
 * them), so it is the single source of truth for the trust boundary.
 *
 * Why a referee at all? In tldraw sync the document is a CRDT every client
 * holds in full — there are no secrets in the store, and no built-in arbiter.
 * Anything whose correctness depends on info a client must NOT have (a fair die
 * roll, a hidden shuffle, a face-down value) is performed by the referee and
 * only its REDACTED / authorized result is written back. See SPEC §1–§3.
 *
 * These requests travel over the sync WebSocket as a custom envelope
 * (`{ kind: 'referee', ... }`), NOT as store edits.
 */

/** A durable game role. Ownership & entitlement are always expressed as seats. */
export type SeatId = string & { readonly __brand: 'SeatId' }
/** One live WebSocket connection. Ephemeral; a reconnect mints a new one. */
export type SessionId = string & { readonly __brand: 'SessionId' }
/** tldraw shape id (kept loose here to avoid a client-only import in the worker). */
export type ShapeId = string

/**
 * Proof of who may (re)claim a seat. The ONLY place the system distinguishes a
 * logged-in user from a guest — everything downstream sees only a SeatId (§3.7).
 */
export type IdentityProof =
	| { kind: 'user'; token: string } // verified server-side against your auth
	| { kind: 'guest'; guestId: string; secret: string } // device-persisted

// ── REQUESTS (client → referee) ──────────────────────────────────────────────

export type RefereeRequest =
	| { action: 'claimSeat'; seatId: SeatId; identity: IdentityProof }
	| { action: 'roll'; dieId: ShapeId }
	| { action: 'shuffle'; containerId: ShapeId }
	| { action: 'draw'; containerId: ShapeId; toSeat: SeatId }
	| { action: 'drawRandom'; containerId: ShapeId; toSeat: SeatId }
	| { action: 'flip'; cardId: ShapeId }
	| { action: 'reveal'; cardId: ShapeId; to: 'table' | SeatId }

/** Every request carries an idempotency key so a referee restart can dedupe (§3.6). */
export type RefereeEnvelope = {
	kind: 'referee'
	requestId: string
	request: RefereeRequest
}

// ── RESPONSES (referee → client) ─────────────────────────────────────────────

export type RefereeResponse =
	| { kind: 'referee'; requestId: string; ok: true; result?: RefereeResult }
	| { kind: 'referee'; requestId: string; ok: false; error: string }

export type RefereeResult =
	| { type: 'rolled'; dieId: ShapeId; value: number }
	| { type: 'seatClaimed'; seatId: SeatId }
	/** A private reveal delivered to ONE seat — value never enters the store (§3.4). */
	| { type: 'privateReveal'; cardId: ShapeId; value: unknown }

export function isRefereeEnvelope(msg: unknown): msg is RefereeEnvelope {
	return (
		typeof msg === 'object' &&
		msg !== null &&
		(msg as { kind?: unknown }).kind === 'referee' &&
		'request' in msg
	)
}
