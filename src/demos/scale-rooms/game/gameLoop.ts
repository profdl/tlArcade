/**
 * GAME LOOP — the impure orchestrator (the one file that touches the editor + tick).
 * ===================================================================================
 * Builds the whole nested room tree, drops the player in the root room, and rides
 * editor.on('tick') to move the player (WASD/arrows), slide-collide against the current
 * room's floor, and dive IN/OUT of scales at portal-doorways.
 *
 * The world is a TREE of square rooms (roomTree.ts): each room's children are SMALLER
 * rooms drawn OVERLAPPING its floor, one colour per level (cycling every three depths).
 * There are no hallways — a child's orange doorway sits right on its own boundary, on the
 * parent's walkable floor. Walk onto a child's doorway (an 'in' trigger, at parent scale)
 * and the camera dives in, landing you inside that child on its matching 'out' doorway.
 * Walk onto a room's own doorway (its 'out' trigger) and you dive back out to the parent.
 *
 * `editor` camera-zoom easing IS the dive effect — no frames, no clipping. Every room's
 * shapes are written up front, so a dive is pure camera + player-reposition + stack push/
 * pop. Follows the repo's native-first pattern: one register* fn, rides the tick, writes
 * via editor.run(..., { history: 'ignore' }), returns a disposer.
 */
import { createShapeId, type Editor, type TLShapeId, type TLShapePartial } from 'tldraw'
import { LAND_OFFSET, PLAYER_FRACTION, PLAYER_SPEED_ROOMS_PER_SEC, ROOM_BUDGET, SCALE_RATIO, ZOOM_DURATION_MS, ZOOM_INSET } from './constants.ts'
import { resolveMove, findClearPoint, type AABB } from './collision.ts'
import { generateWorld, outwardNormal, type PageRect, type PortalInfo, type RoomLayout, type RoomNode } from './roomTree.ts'
import { validateWorldTree } from './validateWorld.ts'
import { LevelManager, obstacleRects, walkableRects } from './levelManager.ts'
import type { KeyState } from './keys.ts'
import { createPlayer, getPlayerAABB, PLAYER_SHAPE_ID, setPlayerPosition, setPlayerRect } from './player.ts'
import { STYLES, type StyleName } from './styles.ts'

/** Which world style the picker selected (styles.ts). Camera/dive machinery is style-agnostic. */
export type WorldConfig = { style: StyleName }
// Default to the corner-spiral: children snap to distinct parent corners, so each room keeps
// a wide L-shaped walkable floor and doors sit on distinct interior edges — the cleanest play
// and the size-chart's nested-corner look. Other placements are available in the picker.
export const DEFAULT_CONFIG: WorldConfig = { style: 'corners' }

/** A running game exposes a disposer plus a live handle to rebuild the world in place. */
export type GameHandle = {
	dispose: () => void
	/** Tear down the current world and rebuild it under `config` (same editor, same player). */
	regenerate: (config: WorldConfig) => void
	getConfig: () => WorldConfig
}

/** Centre of a page rect. */
function centre(r: PageRect): { x: number; y: number } {
	return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** Where the player must NOT be placed on spawn/landing: the level's solid child rooms AND
 *  its doorway hit zones — so the arrival point is on open floor and the dive trigger arms
 *  (rather than firing/wedging immediately because we dropped the player onto a door). */
function placementAvoid<Id>(node: RoomNode<Id>): AABB[] {
	return [...obstacleRects(node), ...node.layout.portals.map((p) => p.hit)]
}

/**
 * The camera zoom (z) that fits a room into the viewport — the same math `zoomToBounds`
 * uses: min of the width/height ratios, with `inset` screen-px padding. Inset scales by
 * SCALE_RATIO^depth for a constant on-screen margin at every scale.
 */
function fitZoomFor<Id>(editor: Editor, node: RoomNode<Id>): number {
	const { w, h } = node.layout.extent
	const vsb = editor.getViewportScreenBounds()
	const inset = ZOOM_INSET * SCALE_RATIO ** node.depth
	return Math.min((vsb.w - inset * 2) / w, (vsb.h - inset * 2) / h)
}

/** Frame a room at its fit-zoom, CENTRED on a page point — used only for the initial mount
 *  (duration 0). A dive eases zoom while the per-tick follow keeps the player pinned. */
function frameLevel<Id>(editor: Editor, node: RoomNode<Id>, cx: number, cy: number, durationMs: number): void {
	const { w, h } = node.layout.extent
	editor.zoomToBounds(
		{ x: cx - w / 2, y: cy - h / 2, w, h },
		{ inset: ZOOM_INSET * SCALE_RATIO ** node.depth, animation: { duration: durationMs } }
	)
}

export type PortalHit = { kind: 'in' | 'out'; portal: PortalInfo } | { kind: 'none' }

/** True when `p`'s CENTRE lies inside `r`. Used for the dive trigger instead of a plain
 *  AABB overlap: a door reaches DOOR_HALF onto the parent floor, so an edge-touch test fires
 *  while the player is still a door-half SHORT of the wall — i.e. out on open floor, not yet
 *  on the visible orange leaf. Requiring the centre to be ON the door makes the dive fire when
 *  the snail is standing on the doorway you see, not merely brushing its outer edge. */
function centreInside(p: AABB, r: PageRect): boolean {
	const cx = p.x + p.w / 2
	const cy = p.y + p.h / 2
	return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
}

/**
 * Which portal-doorway (if any) the player is standing on — PURE, so it's unit-testable
 * without an editor. A non-root room has an 'out' door AND one 'in' door per child, so we
 * check both. 'out' wins ties: you ARRIVE standing on a doorway, and an 'out' door (inside
 * the room, near its own wall) vs an 'in' door (out at a child's edge) rarely coincide.
 *
 * A dive fires only when the player's CENTRE is on the door (centreInside), not on any AABB
 * touch: the visible orange leaf IS the trigger, so you must be standing ON it — walking up to
 * the wall and merely grazing the door's outer edge no longer teleports you early.
 */
export function portalAt<Id>(layout: RoomLayout<Id>, player: AABB): PortalHit {
	const out = layout.portals.find((p) => p.kind === 'out' && centreInside(player, p.hit))
	if (out) return { kind: 'out', portal: out }
	const inn = layout.portals.find((p) => p.kind === 'in' && centreInside(player, p.hit))
	if (inn) return { kind: 'in', portal: inn }
	return { kind: 'none' }
}

/** A fresh 32-bit world seed — a NEW world every game start. */
export function randomWorldSeed(): number {
	return (Math.random() * 0x100000000) >>> 0
}

/** Flatten every room's drawn rects into shape partials, pre-order (parents before children,
 *  so children draw ON TOP of the parent floor they overlap). */
function collectPartials<Id extends TLShapeId>(node: RoomNode<Id>, out: TLShapePartial[]): void {
	for (const r of node.layout.rects) {
		out.push({ id: r.id, type: 'geo', x: r.x, y: r.y, props: { ...r.props, w: r.w, h: r.h } } as TLShapePartial)
	}
	for (const child of node.children) collectPartials(child, out)
}

export function registerGame(editor: Editor, keys: KeyState, opts?: { seed?: number; config?: WorldConfig }): GameHandle {
	const playerSizeFor = (roomSize: number) => roomSize * PLAYER_FRACTION
	const speedFor = (roomSize: number) => PLAYER_SPEED_ROOMS_PER_SEC * roomSize // px/sec

	// Per-WORLD state (reassigned on every (re)build). The tick and dive closures read these
	// live, so regenerating swaps the world under a running tick without re-registering it.
	let manager = new LevelManager<TLShapeId>()
	let worldSeed = opts?.seed ?? randomWorldSeed()
	let config: WorldConfig = opts?.config ?? DEFAULT_CONFIG

	// A trigger fires only once the player has STEPPED OFF it since arriving — so landing ON a
	// doorway (every dive lands you on the destination doorway's centre) doesn't instantly re-fire.
	let triggerArmed = false

	/**
	 * Tear down whatever is on the page and build a fresh world under `nextConfig`, reusing the
	 * same editor + player. Called at register and whenever the user picks a new style. The seed
	 * is preserved across a style change (comparable worlds); pass a fresh seed to reroll.
	 */
	function buildWorld(nextConfig: WorldConfig, nextSeed?: number): void {
		config = nextConfig
		if (nextSeed !== undefined) worldSeed = nextSeed
		manager = new LevelManager<TLShapeId>()
		triggerArmed = false

		// Clean slate: StrictMode double-invokes onMount in dev, route switches re-mount, and a
		// regenerate replaces the world — none may stack a second world. Room rects mint fresh ids
		// each build; the player's fixed id is recreated below regardless.
		editor.run(() => editor.deleteShapes(editor.getCurrentPageShapes().map((s) => s.id)), { history: 'ignore', ignoreShapeLock: true })

		const { root, count } = generateWorld(() => createShapeId(), worldSeed, STYLES[config.style])
		console.info(`[scale-rooms] world seed: ${worldSeed}, style: ${config.style}, ${count} rooms (reproduce with ?seed=${worldSeed})`)
		if (count >= ROOM_BUDGET) {
			console.warn(`[scale-rooms] room budget ${ROOM_BUDGET} reached (seed ${worldSeed}); the world was capped there.`)
		}
		manager.pushRoot(root)

		// Write every room's shapes in one history-ignored batch, root behind everything.
		const partials: TLShapePartial[] = []
		collectPartials(root, partials)
		editor.run(
			() => {
				editor.createShapes(partials)
				editor.sendToBack(partials.map((p) => p.id!))
			},
			{ history: 'ignore' }
		)

		// Dev-only: assert the recursive geometry invariants loudly (also swept in tests).
		if (import.meta.env.DEV) {
			for (const v of validateWorldTree(root)) {
				console.error(`[scale-rooms] INVARIANT VIOLATED (seed ${worldSeed}, style ${config.style}): ${v}`)
			}
		}

		// Player spawns on the root room's walkable floor, sized to the root room. The centre
		// may sit inside a solid child, so nudge to the nearest clear spot.
		const size = playerSizeFor(root.roomSize)
		const c = centre(root.rect)
		const spawn = findClearPoint(c.x, c.y, size, walkableRects(root), placementAvoid(root))
		createPlayer(editor, spawn.x, spawn.y, size)
		frameLevel(editor, root, spawn.x, spawn.y, 0)
	}

	buildWorld(config)

	// The camera follows the player each tick. A dive changes ZOOM ONLY — we ease z from the
	// current level's fit-zoom to the target's over ZOOM_DURATION_MS, while the follow keeps
	// centring on the LIVE player every frame, so nothing pans out from under it. The zoom is
	// interpolated GEOMETRICALLY (lerp in log-space): each frame multiplies the scale by a
	// constant factor, so a large-ratio dive reads as smooth, constant-speed motion. (Same
	// mechanism as Scale Portals — see its gameLoop for the full rationale.)
	let zoomLogFrom = 0
	let zoomLogTo = 0
	let zoomElapsedMs = 0
	let zoomDurationMs = 0
	const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
	function startZoomTo(target: number): void {
		zoomLogFrom = Math.log(editor.getCamera().z)
		zoomLogTo = Math.log(target)
		zoomElapsedMs = 0
		zoomDurationMs = ZOOM_DURATION_MS
	}

	/** A point `dist` past `door`'s centre along `edge`'s normal (`sign` +1 = outward, -1 = inward). */
	function landNear(door: PageRect, edge: 'N' | 'S' | 'E' | 'W', sign: number, dist: number): { x: number; y: number } {
		const n = outwardNormal(edge)
		const c = centre(door)
		return { x: c.x + n.x * sign * dist, y: c.y + n.y * sign * dist }
	}

	// Dive IN through a child's doorway: descend into that child, LANDING just INSIDE the child
	// past its doorway (then nudged onto clear floor off any door), so you arrive in the room.
	function diveIn(portal: PortalInfo): void {
		const from = manager.current()
		const child = from.children.find((c) => c.key === portal.childKey)
		if (!child || !child.connEdge) return
		manager.pushChild(child)
		const size = playerSizeFor(child.roomSize)
		const target = landNear(portal.hit, child.connEdge, -1, child.roomSize * LAND_OFFSET) // inward
		const dest = findClearPoint(target.x, target.y, size, walkableRects(child), placementAvoid(child))
		setPlayerRect(editor, dest.x, dest.y, size)
		editor.bringToFront([PLAYER_SHAPE_ID])
		startZoomTo(fitZoomFor(editor, child))
		triggerArmed = false
	}

	// Dive OUT through this room's doorway: pop to the parent, LANDING just OUTSIDE this room
	// past the doorway (on parent floor, nudged clear of any door), facing where you came from.
	function diveOut(): void {
		const child = manager.current()
		const parent = manager.popToParent()
		if (!parent || !child.connEdge) return
		const out = child.layout.portals.find((p) => p.kind === 'out')
		const size = playerSizeFor(parent.roomSize)
		const door = out ? out.hit : child.rect
		const target = landNear(door, child.connEdge, +1, child.roomSize * LAND_OFFSET) // outward, onto parent floor
		const dest = findClearPoint(target.x, target.y, size, walkableRects(parent), placementAvoid(parent))
		setPlayerRect(editor, dest.x, dest.y, size)
		editor.bringToFront([PLAYER_SHAPE_ID])
		startZoomTo(fitZoomFor(editor, parent))
		triggerArmed = false
	}

	const onTick = (elapsedMs: number) => {
		const level = manager.current()
		const dir = keys.axis()

		// Move (normalised diagonals), slide-collide against this room's floor.
		if (dir.x !== 0 || dir.y !== 0) {
			const len = Math.hypot(dir.x, dir.y)
			const step = (speedFor(level.roomSize) * elapsedMs) / 1000
			const dx = (dir.x / len) * step
			const dy = (dir.y / len) * step
			const box = getPlayerAABB(editor)
			const resolved = resolveMove(box, dx, dy, walkableRects(level), obstacleRects(level))
			if (resolved.x !== box.x || resolved.y !== box.y) setPlayerPosition(editor, resolved.x, resolved.y)
		}

		const player = getPlayerAABB(editor)
		const playerCentre = { x: player.x + player.w / 2, y: player.y + player.h / 2 }

		// Camera follows the player EVERY frame (keeps it pinned across a dive). While a dive's
		// zoom transition runs, ease z toward the target first, then re-centre on the live player.
		if (zoomElapsedMs < zoomDurationMs) {
			zoomElapsedMs = Math.min(zoomElapsedMs + elapsedMs, zoomDurationMs)
			const t = easeInOutCubic(zoomElapsedMs / zoomDurationMs)
			const z = Math.exp(zoomLogFrom + (zoomLogTo - zoomLogFrom) * t)
			editor.setCamera({ ...editor.getCamera(), z }, { immediate: true })
		}
		editor.centerOnPoint(playerCentre, { immediate: true })

		const portal = portalAt(level.layout, player)
		// A trigger fires only once you've STEPPED OFF every doorway since arriving.
		if (!triggerArmed) {
			if (portal.kind === 'none') triggerArmed = true
			return
		}
		if (portal.kind === 'out') diveOut()
		else if (portal.kind === 'in') diveIn(portal.portal)
	}

	editor.on('tick', onTick)
	return {
		dispose: () => editor.off('tick', onTick),
		regenerate: (next: WorldConfig) => buildWorld(next),
		getConfig: () => config,
	}
}
