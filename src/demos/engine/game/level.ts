/**
 * Engine — the default starter level.
 *
 * A `Placement` is a role plus a page position (and optional size override, so
 * the same role can be reused as, say, a long floor or a short platform). The
 * level is authored in native geo shapes via `shapeForRole` — same as anything
 * the tray drops — so a reset produces exactly the kind of scene a player would
 * build by hand.
 *
 * `loadLevel` clears the page and lays the level down; App loads it on first
 * visit (empty canvas) and the Reset button reloads it.
 */
import type { Editor } from 'tldraw'
import { ROLES, shapeForRole, tiles, type Role } from './roles'
import { createBuilderPlayer } from './builder'

export interface Placement {
  role: Role
  x: number
  y: number
  w?: number
  h?: number
}

/**
 * A small, winnable platformer, authored on the 60px tile grid (see roles.ts →
 * TILE): jump the hazard, climb the 2-tile steps collecting all three tokens,
 * then drop to the goal on the right. Positions and sizes are whole/half tile
 * multiples via `tiles()`; the ground sits at y=480 (tile row 8), platforms two
 * tiles up each step. The player is 2 tiles tall, so steps rise ~1 tile each.
 */
const T = tiles
export const DEFAULT_LEVEL: Placement[] = [
  // Ground floor: a 14-tile-wide, 2-tile-tall slab. Top at y=480.
  { role: 'wall', x: T(1), y: T(8), w: T(14), h: T(2) },
  // A staircase of 3-tile-wide platforms, each rising one tile.
  { role: 'wall', x: T(5), y: T(7), w: T(3), h: T(1) },
  { role: 'wall', x: T(9), y: T(6), w: T(3), h: T(1) },
  { role: 'wall', x: T(12), y: T(5), w: T(3), h: T(1) },
  // Player (the drawn builder, 2 tiles tall) standing on the ground at the left.
  { role: 'player', x: T(2), y: T(6) },
  // A hazard on the ground to jump over (1 tile wide, half tall).
  { role: 'hazard', x: T(3), y: T(7.5) },
  // Tokens, one above each step.
  { role: 'token', x: T(6.25), y: T(6) },
  { role: 'token', x: T(10.25), y: T(5) },
  { role: 'token', x: T(13.25), y: T(4) },
  // An enemy patrolling the ground floor — stomp it from above, or dodge it.
  { role: 'enemy', x: T(6), y: T(7) },
  // Goal, standing on the ground at the far right (2 tiles tall).
  { role: 'goal', x: T(13.5), y: T(6) },
]

/**
 * Replace everything on the page with `level`. `ignoreHistory` keeps the initial
 * populate off the undo stack; a user-triggered reset leaves it undoable.
 */
/** Load a template's frozen level data (an authoring action → undoable). Rules
 *  are applied by the caller (App wires them into the runtime). */
export function loadTemplateLevel(editor: Editor, level: Placement[]) {
  loadLevel(editor, level)
}

export function loadLevel(editor: Editor, level: Placement[] = DEFAULT_LEVEL, ignoreHistory = false) {
  editor.run(
    () => {
      const ids = editor.getCurrentPageShapes().map((s) => s.id)
      if (ids.length) editor.deleteShapes(ids)
      for (const p of level) {
        // The player is the hand-drawn BUILDER (a marked group of draw strokes),
        // not a geo shape — see game/builder.ts. Everything else is its geo shape.
        if (p.role === 'player') {
          const h = p.h ?? ROLES.player.size.h
          createBuilderPlayer(editor, p.x, p.y, h)
          continue
        }
        const base = shapeForRole(p.role)
        editor.createShape({
          ...base,
          x: p.x,
          y: p.y,
          props: {
            ...base.props,
            ...(p.w != null ? { w: p.w } : {}),
            ...(p.h != null ? { h: p.h } : {}),
          },
        })
      }
    },
    ignoreHistory ? { history: 'ignore', ignoreShapeLock: true } : undefined,
  )
  editor.zoomToFit({ animation: { duration: 200 } })
}
