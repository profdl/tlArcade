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
import { shapeForRole, type Role } from './roles'

export interface Placement {
  role: Role
  x: number
  y: number
  w?: number
  h?: number
}

/** A small, winnable platformer: jump the hazard, climb the steps collecting
 *  all three tokens, then drop to the goal on the right. */
export const DEFAULT_LEVEL: Placement[] = [
  // Ground + steps.
  { role: 'wall', x: 40, y: 440, w: 820, h: 32 },
  { role: 'wall', x: 260, y: 380, w: 150, h: 24 },
  { role: 'wall', x: 470, y: 320, w: 150, h: 24 },
  { role: 'wall', x: 680, y: 260, w: 150, h: 24 },
  // Player, on the ground at the left.
  { role: 'player', x: 90, y: 360 },
  // A hazard on the ground to jump over.
  { role: 'hazard', x: 160, y: 412, w: 100, h: 28 },
  // Tokens, one per step.
  { role: 'token', x: 320, y: 340 },
  { role: 'token', x: 530, y: 280 },
  { role: 'token', x: 740, y: 220 },
  // Goal, on the ground at the far right.
  { role: 'goal', x: 792, y: 368 },
]

/**
 * Replace everything on the page with `level`. `ignoreHistory` keeps the initial
 * populate off the undo stack; a user-triggered reset leaves it undoable.
 */
export function loadLevel(editor: Editor, level: Placement[] = DEFAULT_LEVEL, ignoreHistory = false) {
  editor.run(
    () => {
      const ids = editor.getCurrentPageShapes().map((s) => s.id)
      if (ids.length) editor.deleteShapes(ids)
      for (const p of level) {
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
