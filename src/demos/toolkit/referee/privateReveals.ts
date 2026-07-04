/**
 * PRIVATE REVEALS  (SPEC §3.4)
 * ============================
 * The receive side of the referee's owner-only channel. The referee pushes a
 * value to ONE client via `sendCustomMessage`; it arrives here through
 * `useSync({ onCustomMessageReceived })`. The value is held in a reactive atom
 * and rendered locally by the owning card — it is NEVER written to the synced
 * store, so other players (and devtools) cannot see it.
 *
 * Stored in a tldraw `atom` (not a plain Map) so that the card's `useValue`
 * recomputes and re-renders the moment a reveal lands.
 */
import { atom } from 'tldraw'
import type { RefereeResponse } from 'shared/referee-protocol'

/** cardId → privately revealed value (this client only). Reactive. */
const revealed = atom<Map<string, unknown>>('privateReveals', new Map())

export function onRefereePrivateMessage(data: unknown) {
	const msg = data as RefereeResponse
	if (msg?.kind !== 'referee' || !msg.ok || !msg.result) return
	if (msg.result.type === 'privateReveal') {
		const next = new Map(revealed.get())
		next.set(msg.result.cardId, msg.result.value)
		revealed.set(next)
	}
}

/** Read a value the referee revealed only to this client (reactive in useValue). */
export function getPrivateReveal(cardId: string): unknown {
	return revealed.get().get(cardId)
}
