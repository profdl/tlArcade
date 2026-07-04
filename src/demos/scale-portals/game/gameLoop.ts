/**
 * GAME LOOP — the impure orchestrator (the one file that touches the editor + tick).
 * ===================================================================================
 * Builds the parent world, drops the player, and rides editor.on('tick') to move the
 * player (WASD/arrows), slide-collide against the current level's floor, and dive
 * IN/OUT of scales at submap slots.
 *
 * The world ALTERNATES blue rooms with free-standing small-maps (the cell-role model,
 * see mapGeometry.ts): a submap cell renders no room — its nested child map sits in
 * the cell's SLOT, and the parent's tunnels run right up to (and a few px into) the
 * slot. Walking to the end of such a tunnel overlaps the slot and dives you in,
 * arriving at the orange GATE facing the side you came from. Stepping onto ANY gate
 * dives you back out into that gate's tunnel — deterministic 1:1 tunnel↔gate pairing,
 * no entrance/exit roles.
 *
 * `editor.zoomToBounds` on a map's bounds IS the dive effect — no frames, no clipping.
 * Camera animations are non-blocking, so a held key keeps moving the player as the
 * camera eases. Follows the repo's native-first behaviour pattern (see toolkit's
 * registerSwimming): one register* fn, rides the tick, writes via editor.run(...,
 * { history: 'ignore' }), returns a disposer.
 */
import { createShapeId, type Editor, type TLShapeId, type TLShapePartial } from 'tldraw'
import {
	CHILD_GAP,
	CHILD_H,
	CHILD_REMOVE_PROB,
	CHILD_ROOM,
	CHILD_W,
	GAP,
	PARENT_H,
	PARENT_REMOVE_PROB,
	PARENT_ROOM,
	PARENT_W,
	PLAYER_FRACTION,
	PLAYER_SPEED_ROOMS_PER_SEC,
	SLOT,
	SLOT_POKE,
	ZOOM_DURATION_MS,
	ZOOM_INSET,
} from './constants.ts'
import { aabbOverlaps, resolveMove } from './collision.ts'
import { buildMapLayout, childSeedFor, CHILD_ROOM_PROPS, type GateInfo, type MapLayout, type PageRect, type SubmapInfo } from './mapGeometry.ts'
import { validateWorld, type WorldChild } from './validateWorld.ts'
import { LevelManager, submapKey, walkableRects, type LevelState } from './levelManager.ts'
import type { KeyState } from './keys.ts'
import type { Dir } from '../wfc/tiles.ts'
import { createPlayer, getPlayerAABB, PLAYER_SHAPE_ID, setPlayerPosition, setPlayerRect } from './player.ts'

/** The full page-space bounds of a level's map — what the camera zooms to fit. */
function mapBounds(level: LevelState<TLShapeId>): PageRect {
	return { x: level.originX, y: level.originY, w: level.layout.extent.w, h: level.layout.extent.h }
}

/** Centre of a page rect. */
function centre(r: PageRect): { x: number; y: number } {
	return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** A fresh 32-bit world seed — a NEW map every game start. */
export function randomWorldSeed(): number {
	return (Math.random() * 0x100000000) >>> 0
}

/** Which side of `rect` the point is off toward — the dominant axis of the offset from
 *  the rect's centre. Used to turn "where the player touched a slot" into a gate edge. */
function approachSide(px: number, py: number, rect: PageRect): Dir {
	const c = centre(rect)
	const dx = px - c.x
	const dy = py - c.y
	if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'W' : 'E'
	return dy < 0 ? 'N' : 'S'
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
		role: 'parent',
		slotSize: SLOT,
		slotPoke: SLOT_POKE,
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

	// Build + write EACH submap's child map eagerly, filling its slot, so the tiny maps
	// sit there visibly before you enter. Each is cached by cell, so diving in reuses
	// its shapes (no regeneration/duplication). Gates: one per tunnel direction.
	const builtChildren: WorldChild<TLShapeId>[] = []
	function buildChildInSlot(parentLevel: LevelState<TLShapeId>, submap: SubmapInfo): LevelState<TLShapeId> {
		const layout = buildMapLayout(
			() => createShapeId(),
			CHILD_W,
			CHILD_H,
			childSeedFor(worldSeed, submap.cell),
			submap.slotRect.x,
			submap.slotRect.y,
			CHILD_ROOM,
			CHILD_GAP,
			{
				removeProb: CHILD_REMOVE_PROB,
				role: 'child',
				gateEdges: submap.doorDirs,
				roomProps: CHILD_ROOM_PROPS,
			}
		)
		const child: LevelState<TLShapeId> = {
			depth: parentLevel.depth + 1,
			layout,
			roomSize: CHILD_ROOM,
			gap: CHILD_GAP,
			originX: submap.slotRect.x,
			originY: submap.slotRect.y,
			parentDepth: parentLevel.depth,
			parentSlotRect: submap.slotRect,
		}
		manager.cacheChild(submapKey(submap.cell), child)
		writeLevelRects(editor, layout, false)
		builtChildren.push({ submap, layout })
		return child
	}
	for (const submap of parentLayout.submaps) buildChildInSlot(parent, submap)

	// With random seeds, the gate↔tunnel connection invariants must hold for ANY world —
	// assert them loudly in dev (they're also swept across hundreds of seeds in tests).
	if (import.meta.env.DEV) {
		const violations = validateWorld(parentLayout, builtChildren, { w: CHILD_W, h: CHILD_H })
		for (const v of violations) {
			 
			console.error(`[scale-portals] INVARIANT VIOLATED (seed ${worldSeed}): ${v}`)
		}
	}

	// Player spawns at the parent's spawn-room centre, sized to the parent room.
	const spawn = centre(parentLayout.spawnRect)
	createPlayer(editor, spawn.x, spawn.y, playerSizeFor(PARENT_ROOM))

	// Frame the parent world immediately (no animation on first mount).
	editor.zoomToBounds(mapBounds(parent), { inset: ZOOM_INSET, animation: { duration: 0 } })

	// A trigger only fires once the player has STEPPED OFF it since arriving — so
	// emerging next to a slot (or arriving on a gate) doesn't immediately re-fire.
	let triggerArmed = false

	function diveIn(submap: SubmapInfo): void {
		const from = manager.current()
		const child = manager.getCachedChild(submapKey(submap.cell)) ?? buildChildInSlot(from, submap)
		manager.pushChild(child)
		// Arrive at the gate FACING the tunnel you came through: the player touched the
		// slot on some side; that side's gate is the pairing. Fallback (shouldn't happen
		// — a tunnel implies a door implies a gate): the first gate.
		const player = getPlayerAABB(editor)
		const side = approachSide(player.x + player.w / 2, player.y + player.h / 2, submap.slotRect)
		const gate = child.layout.gates.find((g) => g.edge === side) ?? child.layout.gates[0]
		const dest = gate ? centre(gate.rect) : centre(submap.slotRect)
		setPlayerRect(editor, dest.x, dest.y, playerSizeFor(child.roomSize))
		editor.bringToFront([PLAYER_SHAPE_ID])
		editor.zoomToBounds(mapBounds(child), {
			inset: (ZOOM_INSET * CHILD_ROOM) / PARENT_ROOM,
			animation: { duration: ZOOM_DURATION_MS },
		})
		triggerArmed = false
	}

	function diveOut(gate: GateInfo): void {
		const child = manager.current()
		const parentLevel = manager.popToParent()
		if (!parentLevel || !child.parentSlotRect) return
		// Emerge just OUTSIDE the slot in this gate's tunnel: offset from the slot edge
		// along the gate's axis by half the parent-size player plus a small margin,
		// centred on the tunnel's centreline (the cell centreline). The tunnel mouth
		// (~82px) comfortably fits the parent player (~29px).
		const slot = child.parentSlotRect
		const size = playerSizeFor(parentLevel.roomSize)
		const margin = size / 2 + 6
		const c = centre(slot)
		const dest =
			gate.edge === 'W'
				? { x: slot.x - margin, y: c.y }
				: gate.edge === 'E'
					? { x: slot.x + slot.w + margin, y: c.y }
					: gate.edge === 'N'
						? { x: c.x, y: slot.y - margin }
						: { x: c.x, y: slot.y + slot.h + margin }
		setPlayerRect(editor, dest.x, dest.y, size)
		editor.bringToFront([PLAYER_SHAPE_ID])
		editor.zoomToBounds(mapBounds(parentLevel), { inset: ZOOM_INSET, animation: { duration: ZOOM_DURATION_MS } })
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
		if (level.layout.gates.length > 0) {
			// In a child: walk onto ANY orange gate to dive back out toward its tunnel.
			const gate = level.layout.gates.find((g) => aabbOverlaps(player, g.rect))
			if (!triggerArmed) {
				if (!gate) triggerArmed = true
				return
			}
			if (gate) diveOut(gate)
		} else {
			// In the parent: reaching the end of a tunnel overlaps a submap's slot → dive.
			const hit = level.layout.submaps.find((s) => aabbOverlaps(player, s.slotRect))
			if (!triggerArmed) {
				if (!hit) triggerArmed = true
				return
			}
			if (hit) diveIn(hit)
		}
	}

	editor.on('tick', onTick)
	return () => editor.off('tick', onTick)
}
