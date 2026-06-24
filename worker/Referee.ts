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
	/**
	 * SERVER-ONLY secret state (SPEC §2.1). Maps a card id to its hidden value.
	 * This NEVER leaves the referee except through an authorized reveal. The
	 * synced store only ever holds the opaque key (`secretRef`), never the value.
	 */
	private readonly secrets = new Map<string, string>()
	/**
	 * SERVER-ONLY ordered deck/bag contents, keyed by container id. The ORDER is
	 * unknowable to every client (that's the point of a server shuffle). The store
	 * only ever holds the public count. (SPEC §5.5)
	 */
	private readonly decks = new Map<string, string[]>()

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
				case 'stashSecret':
					return await this.stashSecret(sessionId, requestId, req.cardId, req.value, req.owner)
				case 'reveal':
					return await this.reveal(sessionId, requestId, req.cardId, req.to)
				case 'seedDeck':
					return this.seedDeck(requestId, req.containerId, req.values)
				case 'shuffle':
					return await this.shuffle(requestId, req.containerId)
				case 'draw':
					return await this.draw(requestId, req.containerId, req.cardId, req.to, false)
				case 'drawRandom':
					return await this.draw(requestId, req.containerId, req.cardId, req.to, true)
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
		// ⚠️ SECURITY TODO (before any real deployment): the IdentityProof is NOT
		// verified yet. For a 'user' proof, validate the token against your auth
		// (JWT signature / session lookup); for a 'guest' proof, check the
		// (guestId, secret) pair against first-claim. Until this lands, ANY client
		// can claim an unoccupied seat and thus receive its owner-only private
		// reveals — the seat/activeSessions gating is only as strong as this check.
		// Tracked as SPEC §8.1. We currently accept any well-formed proof so the
		// seat plumbing is exercisable end-to-end.
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

	/** Which seat (if any) this session currently occupies. */
	private seatOf(sessionId: SessionId): SeatId | null {
		for (const [seatId, seat] of this.seats) {
			if (seat.activeSessions.has(sessionId)) return seatId
		}
		return null
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

	// ── CARDS / SECRETS (§2.2, §5.2) ─────────────────────────────────────────────

	/**
	 * Take custody of a card's hidden value. The value goes into server-only
	 * `secrets`; the store keeps only the opaque `secretRef`. If `owner` is given,
	 * push the value privately to that seat now (an owner-only card in a hand).
	 */
	private async stashSecret(
		sessionId: SessionId,
		requestId: string,
		cardId: string,
		value: string,
		owner?: SeatId
	): Promise<RefereeResponse> {
		const callerSeat = this.seatOf(sessionId)
		const card = this.room.getRecord(cardId)

		// AUTHORIZATION (defense in depth): you may not stash a secret for a card
		// already owned by a DIFFERENT seat (no overwriting another player's card),
		// and you may not assign ownership to a seat other than your own.
		// NOTE: this assumes the caller's seat is trustworthy — which holds only
		// once claimSeat verifies the IdentityProof (the pre-deploy TODO above).
		const existingOwner = (card?.props?.owner as SeatId | null | undefined) ?? null
		if (existingOwner && existingOwner !== callerSeat) {
			return this.fail(requestId, 'Card is owned by another seat')
		}
		if (owner && owner !== callerSeat) {
			return this.fail(requestId, 'Cannot assign a secret to another seat')
		}

		const secretRef = `secret:${cardId}`
		this.secrets.set(secretRef, value)

		await this.room.updateStore((store) => {
			const card = store.get(cardId)
			if (card) {
				store.put({
					...card,
					props: {
						...card.props,
						state: 'faceDown',
						revealedValue: null, // never leak the value into the store
						secretRef,
						owner: owner ?? null,
					},
				})
			}
		})

		// Owner-only: deliver the value privately so only the owner can see it.
		if (owner) this.pushPrivateReveal(owner, cardId, value)

		this.handledRequests.add(requestId)
		return { kind: 'referee', requestId, ok: true }
	}

	/**
	 * Reveal a stashed secret. `to: 'table'` writes the value publicly into the
	 * store for everyone. `to: <seat>` pushes it privately to that seat only; the
	 * store stays redacted, so no other client (or devtools) sees it.
	 */
	private async reveal(
		sessionId: SessionId,
		requestId: string,
		cardId: string,
		to: 'table' | SeatId
	): Promise<RefereeResponse> {
		const secretRef = `secret:${cardId}`
		const value = this.secrets.get(secretRef)
		if (value === undefined) return this.fail(requestId, `No secret for ${cardId}`)

		// AUTHORIZATION: an OWNED card may only be revealed by its owner (you can't
		// flip another player's hand onto the table, nor peek it into your own).
		// An unowned table card is public — anyone may flip it. (Same trust caveat
		// as stashSecret: only as strong as claimSeat verification.)
		const callerSeat = this.seatOf(sessionId)
		const owner = (this.room.getRecord(cardId)?.props?.owner as SeatId | null | undefined) ?? null
		if (owner && owner !== callerSeat) {
			return this.fail(requestId, 'Card is owned by another seat')
		}

		if (to === 'table') {
			this.secrets.delete(secretRef) // it's public now; no need to keep it hidden
			await this.room.updateStore((store) => {
				const card = store.get(cardId)
				if (card) {
					store.put({
						...card,
						props: {
							...card.props,
							state: 'faceUp',
							revealedValue: value,
							secretRef: null,
							owner: null,
						},
					})
				}
			})
			this.handledRequests.add(requestId)
			return { kind: 'referee', requestId, ok: true }
		}

		// Reveal to a single seat — private push only, store untouched. The value
		// is delivered ONLY through pushPrivateReveal (gated to the seat's
		// occupants). It must NOT appear in this HTTP response: the response goes
		// to whoever made the POST, whose sessionId is unauthenticated and need not
		// own the seat. Returning the value here would be a redaction-boundary leak.
		this.pushPrivateReveal(to, cardId, value)
		this.handledRequests.add(requestId)
		return { kind: 'referee', requestId, ok: true }
	}

	/** Send a value to every live session occupying `seat` (SPEC §3.4). */
	private pushPrivateReveal(seat: SeatId, cardId: string, value: string) {
		const occupants = this.seats.get(seat)?.activeSessions
		if (!occupants) return
		for (const sessionId of occupants) {
			this.room.sendToSession(sessionId, {
				kind: 'referee',
				requestId: '',
				ok: true,
				result: { type: 'privateReveal', cardId, value },
			})
		}
	}

	// ── DECKS / BAGS (§5.5) ───────────────────────────────────────────────────────

	/** Take custody of a container's hidden contents; publish only the count. */
	private seedDeck(requestId: string, containerId: string, values: string[]): RefereeResponse {
		this.decks.set(containerId, [...values])
		void this.room.updateStore((store) => {
			const c = store.get(containerId)
			if (c) store.put({ ...c, props: { ...c.props, count: values.length } })
		})
		this.handledRequests.add(requestId)
		return { kind: 'referee', requestId, ok: true }
	}

	/** Permute the hidden order with the server CSPRNG. No client learns it. */
	private async shuffle(requestId: string, containerId: string): Promise<RefereeResponse> {
		const deck = this.decks.get(containerId)
		if (!deck) return this.fail(requestId, `No deck for ${containerId}`)
		// Fisher–Yates with the fair RNG.
		for (let i = deck.length - 1; i > 0; i--) {
			const j = this.rollFair(i + 1)
			;[deck[i], deck[j]] = [deck[j], deck[i]]
		}
		this.handledRequests.add(requestId)
		return { kind: 'referee', requestId, ok: true }
	}

	/**
	 * Pop one hidden item from a deck onto a pre-created card (`cardId`). To a
	 * seat → owner-only (private push, store redacted). To the table → public.
	 * `random` pops a random index instead of the top.
	 */
	private async draw(
		requestId: string,
		containerId: string,
		cardId: string,
		to: 'table' | SeatId,
		random: boolean
	): Promise<RefereeResponse> {
		const deck = this.decks.get(containerId)
		if (!deck || deck.length === 0) return this.fail(requestId, `Deck ${containerId} is empty`)

		const idx = random ? this.rollFair(deck.length) : deck.length - 1
		const [value] = deck.splice(idx, 1)

		await this.room.updateStore((store) => {
			const container = store.get(containerId)
			if (container) store.put({ ...container, props: { ...container.props, count: deck.length } })

			const card = store.get(cardId)
			if (!card) return
			if (to === 'table') {
				store.put({
					...card,
					props: { ...card.props, state: 'faceUp', revealedValue: value, secretRef: null, owner: null },
				})
			} else {
				// owner-only: store stays redacted; value goes out privately below.
				this.secrets.set(`secret:${cardId}`, value)
				store.put({
					...card,
					props: { ...card.props, state: 'faceDown', revealedValue: null, secretRef: `secret:${cardId}`, owner: to },
				})
			}
		})

		if (to !== 'table') this.pushPrivateReveal(to, cardId, value)

		this.handledRequests.add(requestId)
		return { kind: 'referee', requestId, ok: true }
	}

	// ── helpers ──────────────────────────────────────────────────────────────────
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
