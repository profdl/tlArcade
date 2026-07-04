/**
 * GAME LOOP — the impure orchestrator (the one file that touches the editor + tick).
 * ===================================================================================
 * Builds the parent map, drops the player, and rides editor.on('tick') to move the
 * player (WASD/arrows), slide-collide against the current level's floor, and dive
 * IN/OUT of scales at portals.
 *
 * The parent map ALTERNATES plain blue rooms with portal rooms; each portal room holds
 * a whole nested child map, written at a small scale INSIDE it (so it sits there
 * visibly the whole time — the map-within-a-map). Walking into a portal room dives into
 * its child; the child is a PASS-THROUGH with an entrance (where you appear, at the
 * tunnel you came from) and an exit marker (walk onto it to pop back out).
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
import { aabbOverlaps, resolveMove } from './collision.ts'
import { buildMapLayout, entranceExitEdges, roomExtent, CHILD_ROOM_PROPS, type MapLayout, type PageRect, type PortalInfo } from './mapGeometry.ts'
import { LevelManager, portalKey, walkableRects, type LevelState } from './levelManager.ts'
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

/** A distinct child seed per portal, so every small map is a different layout. */
function childSeedFor(cell: { x: number; y: number }): number {
	return (CHILD_SEED ^ (cell.x * 73856093) ^ (cell.y * 19349663)) >>> 0
}

/** Write a level's rects to the store in one history-ignored batch. `toBack` sends them
 *  behind everything (parent map); children are left on top so they show inside portals. */
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

	// ── Build + write the PARENT map at the page origin (sent to back). ──────────
	const parentLayout = buildMapLayout(() => createShapeId(), PARENT_W, PARENT_H, PARENT_SEED, 0, 0, PARENT_ROOM, GAP, {
		removeProb: PARENT_REMOVE_PROB,
		role: 'parent',
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

	// Build + write EACH portal's child map eagerly, nested inside its portal room, so the
	// tiny maps sit there visibly before you enter. Each is cached by portal cell, so
	// diving in reuses its shapes (no regeneration/duplication). The child is a pass-through:
	// its entrance faces one of the portal room's tunnels, its exit faces another.
	function buildChildInside(parentLevel: LevelState<TLShapeId>, portal: PortalInfo): LevelState<TLShapeId> {
		const childExtent = roomExtent(CHILD_W, CHILD_H, CHILD_ROOM, CHILD_GAP)
		const originX = portal.rect.x + (portal.rect.w - childExtent.w) / 2
		const originY = portal.rect.y + (portal.rect.h - childExtent.h) / 2
		const { entrance, exit } = entranceExitEdges(portal.doorDirs)
		const layout = buildMapLayout(() => createShapeId(), CHILD_W, CHILD_H, childSeedFor(portal.cell), originX, originY, CHILD_ROOM, CHILD_GAP, {
			removeProb: CHILD_REMOVE_PROB,
			role: 'child',
			entranceEdge: entrance,
			exitEdge: exit,
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
			parentPortalRect: portal.rect,
		}
		manager.cacheChild(portalKey(portal.cell), child)
		writeLevelRects(editor, layout, false)
		return child
	}
	for (const portal of parentLayout.portals) buildChildInside(parent, portal)

	// Player spawns at the parent's spawn-room centre, sized to the parent room.
	const spawn = centre(parentLayout.spawnRect)
	createPlayer(editor, spawn.x, spawn.y, playerSizeFor(PARENT_ROOM))

	// Frame the parent map immediately (no animation on first mount).
	editor.zoomToBounds(mapBounds(parent), { inset: ZOOM_INSET, animation: { duration: 0 } })

	// A trigger only fires once the player has STEPPED OFF the marker since arriving — so
	// spawning on a portal (after diving out) or on the entrance doesn't immediately re-fire.
	let triggerArmed = false

	function diveIn(portal: PortalInfo): void {
		const from = manager.current()
		const child = manager.getCachedChild(portalKey(portal.cell)) ?? buildChildInside(from, portal)
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

	function diveOut(via: PageRect): void {
		const parentLevel = manager.popToParent()
		if (!parentLevel) return
		// Emerge at the CENTRE of the orange portal you stepped on. Page space is shared
		// between depths (the child physically sits inside the portal room), so that point
		// is already the right spot in the parent — on the side you left through, inside
		// the portal room (the child fills 82% of it, so even an edge portal's centre plus
		// the parent-size player stays within the room's walkable rect). The camera zooms
		// out around you; you just get bigger where you stand.
		const dest = centre(via)
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

		const player = getPlayerAABB(editor)
		if (level.layout.exitRect) {
			// In a child: walk onto EITHER orange portal (entrance or exit) to pop back out.
			const outRects = [level.layout.spawnRect, level.layout.exitRect]
			const onPortal = outRects.find((r) => aabbOverlaps(player, r))
			if (!triggerArmed) {
				if (!onPortal) triggerArmed = true
				return
			}
			if (onPortal) diveOut(onPortal)
		} else {
			// In the parent: walk into any portal room to dive into its child map.
			const hit = level.layout.portals.find((p) => aabbOverlaps(player, p.rect))
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
