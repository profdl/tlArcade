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
	SHAPE_BUDGET,
	SLOT,
	SLOT_POKE,
	ZOOM_DURATION_MS,
	ZOOM_INSET,
} from './constants.ts'
import { aabbOverlaps, resolveMove, type AABB } from './collision.ts'
import { buildMapLayout, childSeedFor, roomPropsForDepth, type CellRole, type GridCell, type MapLayout, type PageRect, type PortalInfo, type SubmapInfo } from './mapGeometry.ts'
import { validateWorldTree, type WorldNode } from './validateWorld.ts'
import { LevelManager, submapKey, walkableRects, type LevelState } from './levelManager.ts'
import type { KeyState } from './keys.ts'
import { createPlayer, getPlayerAABB, PLAYER_SHAPE_ID, setPlayerPosition, setPlayerRect } from './player.ts'
import { PATTERNS, type PatternName } from './patterns.ts'

/**
 * Which map pattern the world uses — the fractal seam (see patterns.ts). The SAME pattern
 * runs at every scale, so a self-similar rule (e.g. sierpinski) repeats its motif as you dive.
 * Defaults to `grid`, the original seeded coin-flip world. The camera/dive/gate machinery is
 * pattern-agnostic; only WHERE submaps land changes.
 */
export type WorldConfig = { pattern: PatternName }
export const DEFAULT_CONFIG: WorldConfig = { pattern: 'grid' }

/** A running game exposes a disposer plus a live handle to regenerate the world in place. */
export type GameHandle = {
	dispose: () => void
	/** Tear down the current world and rebuild it under `config` (same editor, same player). */
	regenerate: (config: WorldConfig) => void
	getConfig: () => WorldConfig
}

/**
 * The camera zoom (z) that fits a level's map into the viewport — the same math
 * `zoomToBounds` uses: min of the width/height ratios, with `inset` screen-px padding.
 * The player is kept centred SEPARATELY (see the tick's follow), so we only need the zoom,
 * not a full frame. Inset scales by CHILD_SCALE^depth for a constant on-screen margin.
 */
function fitZoomFor(editor: Editor, level: LevelState<TLShapeId>): number {
	const { w, h } = level.layout.extent
	const vsb = editor.getViewportScreenBounds()
	const inset = ZOOM_INSET * CHILD_SCALE ** level.depth
	return Math.min((vsb.w - inset * 2) / w, (vsb.h - inset * 2) / h)
}

/**
 * Frame a level at its fit-zoom, CENTRED on a page point (the player) — used only for the
 * initial mount (duration 0). A dive does NOT use this: it eases zoom while the per-tick
 * follow keeps the player pinned, so nothing pans out from under the player (see onTick).
 */
function frameLevel(editor: Editor, level: LevelState<TLShapeId>, cx: number, cy: number, durationMs: number): void {
	const { w, h } = level.layout.extent
	editor.zoomToBounds(
		{ x: cx - w / 2, y: cy - h / 2, w, h },
		{ inset: ZOOM_INSET * CHILD_SCALE ** level.depth, animation: { duration: durationMs } }
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
	const out = layout.portals.find((p) => p.kind === 'out' && aabbOverlaps(player, p.hit))
	if (out) return { kind: 'out', portal: out }
	const inn = layout.portals.find((p) => p.kind === 'in' && aabbOverlaps(player, p.hit))
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

export function registerGame(editor: Editor, keys: KeyState, opts?: { seed?: number; config?: WorldConfig }): GameHandle {
	const playerSizeFor = (roomSize: number) => roomSize * PLAYER_FRACTION
	const speedFor = (roomSize: number) => PLAYER_SPEED_ROOMS_PER_SEC * roomSize // px/sec

	// ── Per-WORLD state (reassigned on every (re)build). The tick and its dive closures read
	//    these live, so regenerating swaps the whole world under a running game loop without
	//    re-registering the tick. `roleForAt` is the active pattern (patterns.ts), applied at
	//    the SAME rule to every scale so a self-similar pattern reads as a fractal. ──────────
	let manager = new LevelManager<TLShapeId>()
	let worldSeed = opts?.seed ?? randomWorldSeed()
	let config: WorldConfig = opts?.config ?? DEFAULT_CONFIG
	// Running rect count for the current eager build — the SHAPE_BUDGET backstop (see constants).
	let shapesBuilt = 0
	let budgetHit = false
	// A pattern factory is `(w,h,depth,seed) => roleFor`; we build the roleFor per map inside
	// buildChildInSlot / buildWorld (each map gets its own seed + depth), reading `config.pattern`.
	const roleForOf = (w: number, h: number, depth: number, seed: number): ((c: GridCell) => CellRole) =>
		PATTERNS[config.pattern](w, h, depth, seed)

	// Recursively build EVERY submap's child map, filling its slot, so every tiny map (at every
	// depth) sits there visibly before you enter. Each child is cached by its slot's page
	// position, so diving in reuses its shapes. A child at depth d < MAX_DEPTH is a HOST (own
	// slots) and we recurse; at depth === MAX_DEPTH it's a LEAF (rooms + gates, no slots).
	function buildChildInSlot(parentLevel: LevelState<TLShapeId>, submap: SubmapInfo): WorldNode<TLShapeId> {
		const depth = parentLevel.depth + 1
		const isHost = depth < MAX_DEPTH
		const roomSize = roomAtDepth(depth)
		const gap = gapAtDepth(depth)
		const childSeed = childSeedFor(worldSeed, submap.cell, depth)
		const layout = buildMapLayout(
			() => createShapeId(),
			CHILD_W,
			CHILD_H,
			childSeed,
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
				// The active pattern picks its submap cells (same rule at every scale → fractal).
				...(isHost
					? {
							slotSize: roomSize * CHILD_FILL,
							slotPoke: SLOT_POKE * CHILD_SCALE ** depth,
							roleFor: roleForOf(CHILD_W, CHILD_H, depth, childSeed),
							// Force ≥1 submap so an intermediate scale always nests deeper (no dead end).
							ensureSubmap: true,
						}
					: {}),
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
		shapesBuilt += layout.rects.length
		// Recurse into this host child's own submaps — UNLESS the eager build has blown its shape
		// budget, in which case stop descending (this map still renders; its grandchildren are
		// skipped). A dive into a skipped branch lazily builds on demand (diveIn's cache-miss path).
		let children: WorldNode<TLShapeId>[] = []
		if (isHost) {
			if (shapesBuilt >= SHAPE_BUDGET) {
				if (!budgetHit) {
					budgetHit = true
					console.warn(
						`[scale-portals] shape budget ${SHAPE_BUDGET} reached (pattern ${config.pattern}, seed ${worldSeed}); ` +
							`deeper maps build on demand when you dive in.`
					)
				}
			} else {
				children = layout.submaps.map((s) => buildChildInSlot(level, s))
			}
		}
		const node: WorldNode<TLShapeId> = { submap, layout, children }
		return node
	}

	// A trigger only fires once the player has STEPPED OFF it since arriving — so
	// emerging next to a slot (or arriving on a gate) doesn't immediately re-fire.
	let triggerArmed = false

	/**
	 * Tear down whatever is on the page and build a fresh world under `nextConfig`, reusing the
	 * same editor + player. Called once at register (the initial world) and again whenever the
	 * user picks a new pattern in the UI. The seed is preserved across a pattern change, so the
	 * SAME seed under a different pattern is directly comparable; pass a fresh seed to reroll.
	 */
	function buildWorld(nextConfig: WorldConfig, nextSeed?: number): void {
		config = nextConfig
		if (nextSeed !== undefined) worldSeed = nextSeed
		manager = new LevelManager<TLShapeId>()
		triggerArmed = false
		shapesBuilt = 0
		budgetHit = false

		// Clean slate: StrictMode double-invokes onMount in dev, route switches re-mount, and a
		// regenerate replaces the world — none may stack a second map. Map rects mint fresh ids
		// each build; the player's fixed id is recreated below regardless.
		editor.run(
			() => editor.deleteShapes(editor.getCurrentPageShapes().map((s) => s.id)),
			{ history: 'ignore', ignoreShapeLock: true }
		)

		console.info(`[scale-portals] world seed: ${worldSeed}, pattern: ${config.pattern} (reproduce with ?seed=${worldSeed})`)
		// ── Build + write the PARENT (root) world at the page origin (sent to back). ──
		const parentLayout = buildMapLayout(() => createShapeId(), PARENT_W, PARENT_H, worldSeed, 0, 0, PARENT_ROOM, GAP, {
			removeProb: PARENT_REMOVE_PROB,
			hasSlots: true,
			slotSize: SLOT,
			slotPoke: SLOT_POKE,
			roomProps: roomPropsForDepth(0, MAX_DEPTH), // depth 0 → blue
			roleFor: roleForOf(PARENT_W, PARENT_H, 0, worldSeed),
			// A custom pattern can come up all-rooms; force ≥1 submap so the root is never dive-less.
			ensureSubmap: true,
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
		shapesBuilt += parentLayout.rects.length

		const worldTree: WorldNode<TLShapeId>[] = []
		for (const submap of parentLayout.submaps) worldTree.push(buildChildInSlot(parent, submap))

		// With random seeds the gate↔tunnel invariants must hold for ANY world at EVERY depth —
		// assert loudly in dev (also swept across hundreds of seeds in tests). Patterns change
		// WHERE submaps land, not the gate/portal contract, so this guards every pattern too.
		// Skipped when the shape budget truncated the tree: a truncated branch legitimately has a
		// submap with no built child (invariant #1 would false-alarm on that), and the truncated
		// world is a degraded fallback we don't claim the full contract over.
		if (import.meta.env.DEV && !budgetHit) {
			const violations = validateWorldTree(parentLayout, worldTree, { w: CHILD_W, h: CHILD_H })
			for (const v of violations) {
				console.error(`[scale-portals] INVARIANT VIOLATED (seed ${worldSeed}, pattern ${config.pattern}): ${v}`)
			}
		}

		// Player spawns at the parent's spawn-room centre, sized to the parent room.
		const spawn = centre(parentLayout.spawnRect)
		createPlayer(editor, spawn.x, spawn.y, playerSizeFor(PARENT_ROOM))
		// Frame the root world immediately (no animation), centred on spawn. Depth 0 → inset 1.
		frameLevel(editor, parent, spawn.x, spawn.y, 0)
	}

	buildWorld(config)

	// The camera follows the player each tick. A dive changes ZOOM ONLY — we ease z from the
	// current level's fit-zoom to the new level's over ZOOM_DURATION_MS, while the follow keeps
	// centring on the LIVE player every frame. That's what stops the jump: the player is pinned
	// on screen throughout, so nothing pans out from under it; only the world scales. (The old
	// code animated a pan to the destination and held the follow off — the player then drifted
	// during the animation and the camera SNAPPED to it when the hold ended.)
	//
	// The zoom is interpolated GEOMETRICALLY (lerp in log-space), not linearly: a dive spans a
	// huge zoom ratio (~18.75× between depths), and linear-in-z spends nearly all its visual
	// travel in the last few frames — the scale seems to hang, then lurch. Easing the LOG of z
	// makes each frame multiply the scale by a constant factor, so the zoom reads as smooth,
	// constant-speed motion. The ease-in-out shapes the log path for soft start and stop.
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
		const dest = outPortal ? centre(outPortal.land) : gate ? centre(gate.rect) : centre(submap.slotRect)
		setPlayerRect(editor, dest.x, dest.y, playerSizeFor(child.roomSize))
		editor.bringToFront([PLAYER_SHAPE_ID])
		startZoomTo(fitZoomFor(editor, child))
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
			dest = centre(inPortal.land)
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
		startZoomTo(fitZoomFor(editor, parentLevel))
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
		const playerCentre = { x: player.x + player.w / 2, y: player.y + player.h / 2 }

		// Camera follows the player EVERY frame — this is what keeps the player pinned on
		// screen across a dive (the dive only changes zoom, never pans out from under it).
		// While a dive's zoom transition runs, ease z toward the target first, then re-centre
		// on the live player at that z (centerOnPoint recomputes x/y for the current zoom).
		// Both writes are immediate so they don't queue their own animations.
		if (zoomElapsedMs < zoomDurationMs) {
			zoomElapsedMs = Math.min(zoomElapsedMs + elapsedMs, zoomDurationMs)
			const t = easeInOutCubic(zoomElapsedMs / zoomDurationMs)
			const z = Math.exp(zoomLogFrom + (zoomLogTo - zoomLogFrom) * t)
			editor.setCamera({ ...editor.getCamera(), z }, { immediate: true })
		}
		editor.centerOnPoint(playerCentre, { immediate: true })

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
	return {
		dispose: () => editor.off('tick', onTick),
		// Rebuild in place under a new pattern, keeping the current seed so it's comparable.
		regenerate: (next: WorldConfig) => buildWorld(next),
		getConfig: () => config,
	}
}
