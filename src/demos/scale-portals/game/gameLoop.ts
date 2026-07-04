/**
 * GAME LOOP — the impure orchestrator (the one file that touches the editor + tick).
 * ===================================================================================
 * Builds the parent world, drops the player, and rides editor.on('tick') to move the
 * player (WASD/arrows), slide-collide against the current level's floor, and dive
 * IN/OUT of scales at submap slots.
 *
 * The world ALTERNATES rooms with free-standing small-maps (the cell-role model,
 * see mapGeometry.ts); each scale has its own colour (blue → green → light-red at the
 * smallest, roomPropsForDepth): a submap cell renders no room — its nested child map sits in
 * the cell's SLOT, and the parent's tunnels run right up to it. On the boundary at each
 * tunnel mouth sits a small orange PORTAL-DOORWAY. Walking onto an 'in' doorway (in the
 * hallway) dives you in, landing at the CENTRE of the matching 'out' doorway inside the
 * child (in the gate room facing the tunnel you came from). Walking onto an 'out' doorway
 * dives you back out to the centre of its 'in' doorway in the tunnel above — deterministic
 * 1:1 pairing by tunnel direction, no entrance/exit roles.
 *
 * `editor.zoomToBounds` on a map's bounds IS the dive effect — no frames, no clipping.
 * Camera animations are non-blocking, so a held key keeps moving the player as the
 * camera eases. Follows the repo's native-first behaviour pattern (see toolkit's
 * registerSwimming): one register* fn, rides the tick, writes via editor.run(...,
 * { history: 'ignore' }), returns a disposer.
 */
import { createShapeId, type Editor, type TLShapeId, type TLShapePartial } from 'tldraw'
import {
	CHILD_FILL,
	CHILD_H,
	CHILD_REMOVE_PROB,
	CHILD_SCALE,
	CHILD_W,
	GAP,
	gapAtDepth,
	MAX_DEPTH,
	PARENT_H,
	PARENT_REMOVE_PROB,
	PARENT_ROOM,
	PARENT_W,
	PLAYER_FRACTION,
	PLAYER_SPEED_ROOMS_PER_SEC,
	roomAtDepth,
	SLOT,
	SLOT_POKE,
	ZOOM_DURATION_MS,
	ZOOM_INSET,
} from './constants.ts'
import { aabbOverlaps, resolveMove, type AABB } from './collision.ts'
import { buildMapLayout, childSeedFor, roomPropsForDepth, type MapLayout, type PageRect, type PortalInfo, type SubmapInfo } from './mapGeometry.ts'
import { validateWorldTree, type WorldNode } from './validateWorld.ts'
import { LevelManager, submapKey, walkableRects, type LevelState } from './levelManager.ts'
import type { KeyState } from './keys.ts'
import { createPlayer, getPlayerAABB, PLAYER_SHAPE_ID, setPlayerPosition, setPlayerRect } from './player.ts'

/**
 * Frame a level at the depth's fit-zoom, CENTRED on a page point (the player) rather
 * than on the map. zoomToBounds fits a box the size of the level's map — so the zoom is
 * identical at every depth (each level's extent is CHILD_SCALE^depth the root's, and the
 * camera compensates) — but the box is centred on (cx, cy), so that point lands at the
 * viewport centre. This is what makes the dive land already-following the player, so the
 * per-tick follow continues seamlessly. Inset scales by CHILD_SCALE^depth for a constant
 * on-screen margin.
 */
function frameLevel(
	editor: Editor,
	level: LevelState<TLShapeId>,
	cx: number,
	cy: number,
	durationMs: number
): void {
	const { w, h } = level.layout.extent
	editor.zoomToBounds(
		{ x: cx - w / 2, y: cy - h / 2, w, h },
		{
			inset: ZOOM_INSET * CHILD_SCALE ** level.depth,
			animation: { duration: durationMs },
		}
	)
}

/** Centre of a page rect. */
function centre(r: PageRect): { x: number; y: number } {
	return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export type PortalHit =
	| { kind: 'in' | 'out'; portal: PortalInfo }
	| { kind: 'none' }

/**
 * Which portal-doorway (if any) the player is standing on — PURE, so it's unit-testable
 * without an editor. A level can be BOTH host and guest at once (an intermediate map has
 * 'out' doorways to leave by AND 'in' doorways to descend into), so we check BOTH.
 * 'out' wins ties: you ARRIVE standing on a doorway, and an 'out' doorway (inside a gate
 * room) vs an 'in' doorway (out in a hallway) never coincide anyway.
 */
export function portalAt<Id>(layout: MapLayout<Id>, player: AABB): PortalHit {
	const out = layout.portals.find((p) => p.kind === 'out' && aabbOverlaps(player, p.rect))
	if (out) return { kind: 'out', portal: out }
	const inn = layout.portals.find((p) => p.kind === 'in' && aabbOverlaps(player, p.rect))
	if (inn) return { kind: 'in', portal: inn }
	return { kind: 'none' }
}

/** A fresh 32-bit world seed — a NEW map every game start. */
export function randomWorldSeed(): number {
	return (Math.random() * 0x100000000) >>> 0
}

/** Write a level's rects to the store in one history-ignored batch. `toBack` sends them
 *  behind everything (the parent world); children stay on top so they show in slots. */
function writeLevelRects(editor: Editor, layout: MapLayout<TLShapeId>, toBack: boolean): void {
	const partials = layout.rects.map((r) => ({
		id: r.id,
		type: 'geo',
		x: r.x,
		y: r.y,
		props: { ...r.props, w: r.w, h: r.h },
	})) as TLShapePartial[]
	editor.run(
		() => {
			editor.createShapes(partials)
			if (toBack) editor.sendToBack(layout.rects.map((r) => r.id))
		},
		{ history: 'ignore' }
	)
}

export function registerGame(editor: Editor, keys: KeyState, opts?: { seed?: number }): () => void {
	const manager = new LevelManager<TLShapeId>()
	const playerSizeFor = (roomSize: number) => roomSize * PLAYER_FRACTION
	const speedFor = (roomSize: number) => PLAYER_SPEED_ROOMS_PER_SEC * roomSize // px/sec

	// Start from a clean slate: React StrictMode double-invokes onMount in dev, and
	// navigating away/back re-mounts — either way we must not stack a second copy of the
	// map. The map rects use fresh ids each run, so clear everything first (the player's
	// fixed id is recreated below regardless).
	editor.run(
		() => editor.deleteShapes(editor.getCurrentPageShapes().map((s) => s.id)),
		{ history: 'ignore', ignoreShapeLock: true }
	)

	// ── Build + write the PARENT world at the page origin (sent to back). ────────
	// A NEW world every start: the seed defaults to random. Pass opts.seed (e.g. from
	// a ?seed= URL param) to reproduce a specific world — it fully determines the
	// parent AND every child (childSeedFor derives from it).
	const worldSeed = opts?.seed ?? randomWorldSeed()
	 
	console.info(`[scale-portals] world seed: ${worldSeed} (reproduce with ?seed=${worldSeed})`)
	const parentLayout = buildMapLayout(() => createShapeId(), PARENT_W, PARENT_H, worldSeed, 0, 0, PARENT_ROOM, GAP, {
		removeProb: PARENT_REMOVE_PROB,
		hasSlots: true,
		slotSize: SLOT,
		slotPoke: SLOT_POKE,
		roomProps: roomPropsForDepth(0, MAX_DEPTH), // depth 0 → blue
	})
	const parent: LevelState<TLShapeId> = {
		depth: 0,
		layout: parentLayout,
		roomSize: PARENT_ROOM,
		gap: GAP,
		originX: 0,
		originY: 0,
		parentDepth: null,
	}
	manager.pushRoot(parent)
	writeLevelRects(editor, parentLayout, true)

	// Build + write EVERY submap's child map eagerly and RECURSIVELY, filling its slot,
	// so every tiny map (at every depth) sits there visibly before you enter. Each child
	// is cached by its slot's page position, so diving in reuses its shapes. A child at
	// depth d < MAX_DEPTH is itself a HOST (has its own slots) and we recurse into it; at
	// depth === MAX_DEPTH it's a LEAF (all rooms + gates, no slots). Room/gap compound
	// CHILD_SCALE per depth (roomAtDepth/gapAtDepth). Gates: one per host-tunnel direction.
	const worldTree: WorldNode<TLShapeId>[] = []
	function buildChildInSlot(parentLevel: LevelState<TLShapeId>, submap: SubmapInfo): WorldNode<TLShapeId> {
		const depth = parentLevel.depth + 1
		const isHost = depth < MAX_DEPTH
		const roomSize = roomAtDepth(depth)
		const gap = gapAtDepth(depth)
		const layout = buildMapLayout(
			() => createShapeId(),
			CHILD_W,
			CHILD_H,
			childSeedFor(worldSeed, submap.cell, depth),
			submap.slotRect.x,
			submap.slotRect.y,
			roomSize,
			gap,
			{
				removeProb: CHILD_REMOVE_PROB,
				hasSlots: isHost,
				gateEdges: submap.doorDirs,
				// One colour per zoom level; the deepest (leaf) map is light-red.
				roomProps: roomPropsForDepth(depth, MAX_DEPTH),
				// A host child offers its own slots (scaled to its own room), so nesting continues.
				...(isHost ? { slotSize: roomSize * CHILD_FILL, slotPoke: SLOT_POKE * CHILD_SCALE ** depth } : {}),
			}
		)
		const level: LevelState<TLShapeId> = {
			depth,
			layout,
			roomSize,
			gap,
			originX: submap.slotRect.x,
			originY: submap.slotRect.y,
			parentDepth: parentLevel.depth,
			parentSlotRect: submap.slotRect,
		}
		manager.cacheChild(submapKey(submap.slotRect), level)
		writeLevelRects(editor, layout, false)
		// Recurse: build this host child's own children (its grandchildren of the root).
		const children = isHost ? layout.submaps.map((s) => buildChildInSlot(level, s)) : []
		const node: WorldNode<TLShapeId> = { submap, layout, children }
		return node
	}
	for (const submap of parentLayout.submaps) worldTree.push(buildChildInSlot(parent, submap))

	// With random seeds, the gate↔tunnel connection invariants must hold for ANY world at
	// EVERY depth — assert them loudly in dev (also swept across hundreds of seeds in tests).
	if (import.meta.env.DEV) {
		const violations = validateWorldTree(parentLayout, worldTree, { w: CHILD_W, h: CHILD_H })
		for (const v of violations) {

			console.error(`[scale-portals] INVARIANT VIOLATED (seed ${worldSeed}): ${v}`)
		}
	}

	// Player spawns at the parent's spawn-room centre, sized to the parent room.
	const spawn = centre(parentLayout.spawnRect)
	createPlayer(editor, spawn.x, spawn.y, playerSizeFor(PARENT_ROOM))

	// Frame the root world immediately (no animation on first mount), centred on the
	// player's spawn. Depth 0, so the inset scale is 1 — the widest-out framing.
	frameLevel(editor, parent, spawn.x, spawn.y, 0)

	// A trigger only fires once the player has STEPPED OFF it since arriving — so
	// emerging next to a slot (or arriving on a gate) doesn't immediately re-fire.
	let triggerArmed = false

	// The camera follows the player each tick — but a dive kicks off a zoom ANIMATION
	// (frameLevel with a duration), and force-centring mid-animation would cut it short.
	// So a dive holds off the follow for the animation's duration; once it settles (the
	// dive already framed the player), the per-tick follow resumes seamlessly.
	let followHoldMs = 0

	// Dive IN through an 'in' doorway: descend into its submap, LANDING on the child's
	// matching 'out' doorway (same tunnel direction) — its centre sits in the gate room,
	// child-walkable. Fallbacks: the gate centre, then the slot centre.
	function diveIn(portal: PortalInfo): void {
		const submap = portal.submap
		if (!submap) return
		const from = manager.current()
		// Every reachable submap is built eagerly, so the cache always hits; the fallback
		// builds it (and its subtree) on demand — buildChildInSlot caches by slot, so we
		// re-read the level from the cache afterwards regardless of which path ran.
		if (!manager.getCachedChild(submapKey(submap.slotRect))) buildChildInSlot(from, submap)
		const child = manager.getCachedChild(submapKey(submap.slotRect))!
		manager.pushChild(child)
		const outPortal = child.layout.portals.find((p) => p.kind === 'out' && p.dir === portal.dir)
		const gate = child.layout.gates.find((g) => g.edge === portal.dir)
		const dest = outPortal ? centre(outPortal.rect) : gate ? centre(gate.rect) : centre(submap.slotRect)
		setPlayerRect(editor, dest.x, dest.y, playerSizeFor(child.roomSize))
		editor.bringToFront([PLAYER_SHAPE_ID])
		frameLevel(editor, child, dest.x, dest.y, ZOOM_DURATION_MS)
		followHoldMs = ZOOM_DURATION_MS
		triggerArmed = false
	}

	// Dive OUT through an 'out' doorway: pop to the parent, LANDING on the parent's
	// matching 'in' doorway (same submap + tunnel direction) — its centre sits in the
	// hallway, parent-walkable. Fallback (no matching portal): just outside the slot edge
	// on the tunnel centreline, the pre-doorway behaviour.
	function diveOut(portal: PortalInfo): void {
		const child = manager.current()
		const parentLevel = manager.popToParent()
		if (!parentLevel || !child.parentSlotRect) return
		const slot = child.parentSlotRect
		const size = playerSizeFor(parentLevel.roomSize)
		const inPortal = parentLevel.layout.portals.find(
			(p) => p.kind === 'in' && p.dir === portal.dir && p.submap != null && submapKey(p.submap.slotRect) === submapKey(slot)
		)
		let dest: { x: number; y: number }
		if (inPortal) {
			dest = centre(inPortal.rect)
		} else {
			const margin = size / 2 + 6
			const c = centre(slot)
			dest =
				portal.dir === 'W'
					? { x: slot.x - margin, y: c.y }
					: portal.dir === 'E'
						? { x: slot.x + slot.w + margin, y: c.y }
						: portal.dir === 'N'
							? { x: c.x, y: slot.y - margin }
							: { x: c.x, y: slot.y + slot.h + margin }
		}
		setPlayerRect(editor, dest.x, dest.y, size)
		editor.bringToFront([PLAYER_SHAPE_ID])
		frameLevel(editor, parentLevel, dest.x, dest.y, ZOOM_DURATION_MS)
		followHoldMs = ZOOM_DURATION_MS
		triggerArmed = false
	}

	const onTick = (elapsedMs: number) => {
		const level = manager.current()
		const dir = keys.axis()

		// Move (normalised diagonals), slide-collide against this level's floor.
		if (dir.x !== 0 || dir.y !== 0) {
			const len = Math.hypot(dir.x, dir.y)
			const step = (speedFor(level.roomSize) * elapsedMs) / 1000
			const dx = (dir.x / len) * step
			const dy = (dir.y / len) * step
			const box = getPlayerAABB(editor)
			const resolved = resolveMove(box, dx, dy, walkableRects(level))
			if (resolved.x !== box.x || resolved.y !== box.y) setPlayerPosition(editor, resolved.x, resolved.y)
		}

		const player = getPlayerAABB(editor)

		// Camera follows the player, keeping this depth's zoom (centerOnPoint leaves zoom
		// untouched). Held off while a dive's zoom animation plays, then resumes.
		if (followHoldMs > 0) followHoldMs -= elapsedMs
		else editor.centerOnPoint({ x: player.x + player.w / 2, y: player.y + player.h / 2 })

		const portal = portalAt(level.layout, player)
		// A trigger only fires once you've STEPPED OFF every doorway since arriving — so
		// landing ON a doorway (every dive lands you on the destination doorway's centre)
		// doesn't instantly re-fire; you must step off and walk back onto it.
		if (!triggerArmed) {
			if (portal.kind === 'none') triggerArmed = true
			return
		}
		if (portal.kind === 'out') diveOut(portal.portal)
		else if (portal.kind === 'in') diveIn(portal.portal)
	}

	editor.on('tick', onTick)
	return () => editor.off('tick', onTick)
}
