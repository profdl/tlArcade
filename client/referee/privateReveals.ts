/**
 * PRIVATE REVEALS  (SPEC §3.4)
 * ============================
 * The receive side of the referee's owner-only channel. The referee pushes a
 * value to ONE client via `sendCustomMessage`; it arrives here through
 * `useSync({ onCustomMessageReceived })`. The value is held in module state and
 * rendered locally — it is NEVER written to the synced store, so other players
 * (and devtools) cannot see it.
 *
 * Phase 3 fills in card reveals. For now this just records reveals so the
 * channel is wired end-to-end.
 */
import { RefereeResponse } from '../../shared/referee-protocol'

/** cardId → privately revealed value (this client only). */
const privatelyRevealed = new Map<string, unknown>()

export function onRefereePrivateMessage(data: unknown) {
	const msg = data as RefereeResponse
	if (msg?.kind !== 'referee' || !msg.ok || !msg.result) return
	if (msg.result.type === 'privateReveal') {
		privatelyRevealed.set(msg.result.cardId, msg.result.value)
		// TODO(Phase 3): trigger a re-render of the owning card shape.
	}
}

/** Read a value the referee revealed only to this client. */
export function getPrivateReveal(cardId: string): unknown {
	return privatelyRevealed.get(cardId)
}
