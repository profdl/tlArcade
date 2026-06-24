/**
 * useReferee()  (SPEC §3.2)
 * =========================
 * Client side of the referee. Sends a RefereeRequest to the server-authoritative
 * referee and returns its response.
 *
 * TRANSPORT NOTE: the @tldraw/sync socket is ONE-WAY for custom messages
 * (server→client only), so client→referee requests go over plain HTTP POST to
 * `/api/referee/:roomId`. PUBLIC results (e.g. a dice value) come back through
 * normal store sync because the referee writes them with `updateStore`. PRIVATE
 * results (owner-only reveals) are pushed via `onCustomMessageReceived`
 * (wired in Room.tsx).
 */
import { useCallback } from 'react'
import { RefereeRequest, RefereeResponse } from '../../shared/referee-protocol'

/** A stable per-tab id used to address private reveals back to this client. */
const sessionId = crypto.randomUUID()

export function useReferee(roomId: string | undefined) {
	return useCallback(
		async (request: RefereeRequest): Promise<RefereeResponse> => {
			if (!roomId) return { kind: 'referee', requestId: '', ok: false, error: 'No room' }
			const requestId = crypto.randomUUID()
			const res = await fetch(`/api/referee/${roomId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kind: 'referee', requestId, request, sessionId }),
			})
			return (await res.json()) as RefereeResponse
		},
		[roomId]
	)
}

/** This client's referee session id (for matching private reveals). */
export function getRefereeSessionId() {
	return sessionId
}
