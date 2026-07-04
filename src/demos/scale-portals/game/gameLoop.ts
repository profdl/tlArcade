/**
 * GAME LOOP — the impure orchestrator (the one file that touches the editor + tick).
 * ===================================================================================
 * Builds the parent map, drops the player, and rides editor.on('tick') to move the
 * player (WASD/arrows), slide-collide against the current level's floor, and dive
 * IN/OUT of scales when the player steps onto a portal (parent) or exit (child) marker.
 *
 * The nesting is purely geometric: the child map's rectangles are written at a small
 * scale INSIDE the parent's portal room, so they sit there visibly the whole time and
 * `editor.zoomToBounds` on the child's bounds IS the "dive in" effect — no frames, no
 * clipping. Camera animations are non-blocking, so a held movement key keeps driving
 * the player smoothly while the camera eases.
 *
 * Follows the repo's native-first behaviour pattern (see toolkit's registerSwimming):
 * one register* function, rides the shared tick, writes shape positions via
 * editor.run(..., { history: 'ignore' }), and returns a disposer.
 */
import { createShapeId, type Editor, type TLShapeId, type TLShapePartial } from 'tldraw'
import {
	CHILD_GAP,
	CHILD_H,
	CHILD_REMOVE_PROB,
	CHILD_ROOM,
	CHILD_SEED,
	CHILD_W,
	GAP,
	PARENT_H,
	PARENT_REMOVE_PROB,
	PARENT_ROOM,
	PARENT_SEED,
	PARENT_W,
	PLAYER_FRACTION,
	PLAYER_SPEED_ROOMS_PER_SEC,
	ZOOM_DURATION_MS,
	ZOOM_INSET,
} from './constants.ts'
import { aabbOverlaps, resolveMove, type AABB } from './collision.ts'
import { buildMapLayout, roomExtent, CHILD_ROOM_PROPS, type MapLayout, type PageRect } from './mapGeometry.ts'
import { LevelManager, walkableRects, type LevelState } from './levelManager.ts'
import type { KeyState } from './keys.ts'
import { createPlayer, getPlayerAABB, PLAYER_SHAPE_ID, setPlayerPosition, setPlayerRect } from './player.ts'

/** The full page-space bounds of a level's map — what the camera zooms to fit. */
function mapBounds(level: LevelState<TLShapeId>): PageRect {
	return { x: level.originX, y: level.originY, w: level.layout.extent.w, h: level.layout.extent.h }
}

/** Centre of a page rect. */
function centre(r: PageRect): { x: number; y: number } {
	return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** Write a level's rects to the store, sent to BACK, in one history-ignored batch. */
function writeLevelRects(editor: Editor, layout: MapLayout<TLShapeId>): void {
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
			editor.sendToBack(layout.rects.map((r) => r.id))
		},
		{ history: 'ignore' }
	)
}

export function registerGame(editor: Editor, keys: KeyState): () => void {
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

	// ── Build + write the PARENT map at the page origin. ─────────────────────────
	const parentLayout = buildMapLayout(() => createShapeId(), PARENT_W, PARENT_H, PARENT_SEED, 0, 0, PARENT_ROOM, GAP, {
		removeProb: PARENT_REMOVE_PROB,
		special: 'portal',
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
	writeLevelRects(editor, parentLayout)

	// Build + write the CHILD map eagerly, nested inside the parent's portal room, so
	// it sits there visibly (a tiny map-within-a-map) BEFORE you enter — the whole
	// pitch of the demo. It's cached under the parent's depth, so diving in just reuses
	// these shapes (no regeneration, no duplication) — verified by a constant shape count.
	function buildChildInside(parentLevel: LevelState<TLShapeId>): LevelState<TLShapeId> {
		const childExtent = roomExtent(CHILD_W, CHILD_H, CHILD_ROOM, CHILD_GAP)
		const portal = parentLevel.layout.specialRect
		const originX = portal.x + (portal.w - childExtent.w) / 2
		const originY = portal.y + (portal.h - childExtent.h) / 2
		// Put the child's exit/spawn room on the side the parent tunnel enters from, so it
		// lines up with the tunnel mouth (the child map is centred in the portal room, so
		// its edge cell on that side sits right where the tunnel pokes in) — a smooth,
		// connected seam between the two maps.
		const tunnelDir = parentLevel.layout.specialDoorDirs[0]
		const layout = buildMapLayout(() => createShapeId(), CHILD_W, CHILD_H, CHILD_SEED, originX, originY, CHILD_ROOM, CHILD_GAP, {
			removeProb: CHILD_REMOVE_PROB,
			special: 'exit',
			exitEdge: tunnelDir,
			roomProps: CHILD_ROOM_PROPS,
		})
		const child: LevelState<TLShapeId> = {
			depth: parentLevel.depth + 1,
			layout,
			roomSize: CHILD_ROOM,
			gap: CHILD_GAP,
			originX,
			originY,
			parentDepth: parentLevel.depth,
			parentPortalRect: portal,
		}
		manager.cacheChild(parentLevel.depth, child)
		writeLevelRects(editor, layout)
		return child
	}
	buildChildInside(parent)

	// Player spawns at the parent's spawn-room centre, sized to the parent room.
	const spawn = centre(parentLayout.spawnRect)
	createPlayer(editor, spawn.x, spawn.y, playerSizeFor(PARENT_ROOM))

	// Frame the parent map immediately (no animation on first mount).
	editor.zoomToBounds(mapBounds(parent), { inset: ZOOM_INSET, animation: { duration: 0 } })

	// A marker only triggers once the player has STEPPED OFF it since arriving — so
	// spawning on top of a marker (the child's exit, or the portal you return through)
	// doesn't immediately re-fire. Re-armed on any tick the player isn't overlapping it.
	let triggerArmed = false

	function diveIn(): void {
		const from = manager.current()
		// The child was written at startup and cached; build lazily only as a fallback.
		const child = manager.getCachedChild(from.depth) ?? buildChildInside(from)
		manager.pushChild(child)
		const dest = centre(child.layout.spawnRect)
		setPlayerRect(editor, dest.x, dest.y, playerSizeFor(child.roomSize))
		editor.bringToFront([PLAYER_SHAPE_ID])
		editor.zoomToBounds(mapBounds(child), {
			inset: (ZOOM_INSET * CHILD_ROOM) / PARENT_ROOM,
			animation: { duration: ZOOM_DURATION_MS },
		})
		triggerArmed = false
	}

	function diveOut(): void {
		const child = manager.current()
		const parentLevel = manager.popToParent()
		if (!parentLevel || !child.parentPortalRect) return
		const dest = centre(child.parentPortalRect)
		setPlayerRect(editor, dest.x, dest.y, playerSizeFor(parentLevel.roomSize))
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

		// Marker trigger: only when armed (player stepped off the marker since arriving).
		const marker: AABB = level.layout.specialRect
		const onMarker = aabbOverlaps(getPlayerAABB(editor), marker)
		if (!triggerArmed) {
			if (!onMarker) triggerArmed = true
			return
		}
		if (onMarker) {
			if (level.layout.special === 'portal') diveIn()
			else diveOut()
		}
	}

	editor.on('tick', onTick)
	return () => editor.off('tick', onTick)
}
