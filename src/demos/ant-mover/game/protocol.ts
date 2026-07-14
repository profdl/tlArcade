// The ant-mover network protocol — the message shapes on the two out-of-band
// channels (NOT the tldraw sync socket, which carries the document). Imported by
// BOTH the client (netPose.ts / useInput.ts) and the Durable Object
// (worker/AntMoverDurableObject.ts) so the two ends can't drift.
//
// - INPUT channel (client → server, /api/am/input/:roomId WS): the client sends
//   InputMsg — grabs + play/stop control. See the tlarcade-do-realtime-sim skill
//   rule 1/2 (the sync socket can't carry client→server custom data).
// - POSE channel (server → client, room.sendCustomMessage → onCustomMessageReceived):
//   the server sends ServerMsg — the live pose, ropes, run shape, and play-state.

import type { Pose, ObjectShape } from './sim'
import type { WorldSpec } from './shapes'

/** A player's grab in PAGE/BODY-LOCAL terms, matching sim.ts's `Grab`:
 *  `anchor` is the body-local grip in planck meters (+y up); `cursor` is the
 *  page-px target. */
export interface GrabMsg {
	anchor: { x: number; y: number }
	cursor: { x: number; y: number }
}

/** Client → server on the input socket. */
export type InputMsg =
	/** Update this player's grab (drag). */
	| ({ type: 'grab' } & GrabMsg)
	/** Release this player's grab (pointerup / left the object). */
	| { type: 'release' }
	/** Start a run: the pressing client computed the WorldSpec from its editor
	 *  (the DO has no editor), so it ships the authored geometry here. */
	| { type: 'start'; spec: WorldSpec }
	/** Stop the run (back to author mode). */
	| { type: 'stop' }

/** One rope to draw: the grabbed point ON the object (page px, tracks rotation)
 *  → the puller's cursor (page px). `self` is filled per-recipient by the client
 *  (the server doesn't know which rope is "yours" until it addresses you). */
export interface RopeMsg {
	sessionId: string
	anchor: { x: number; y: number }
	cursor: { x: number; y: number }
}

/** Server → client via sendCustomMessage. A discriminated union on `type`. */
export type ServerMsg =
	/** Per-tick physics state: where the object is + every active rope. */
	| { type: 'am-pose'; pose: Pose; ropes: RopeMsg[] }
	/** Run started/stopped: play-state for all clients, and (on start) the object's
	 *  local shape so the overlay can draw the posed body. shape is null on stop. */
	| { type: 'am-play'; playing: boolean; shape: ObjectShape | null }

/** Type guard: is this an ant-mover server message? (onCustomMessageReceived gets
 *  `unknown`.) */
export function isServerMsg(data: unknown): data is ServerMsg {
	return (
		typeof data === 'object' &&
		data !== null &&
		'type' in data &&
		((data as ServerMsg).type === 'am-pose' || (data as ServerMsg).type === 'am-play')
	)
}
