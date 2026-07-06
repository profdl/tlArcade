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

/**
 * Behavior config for a Tier-1 element (PLAN §4.7), stamped onto the shape's `meta`
 * so the runtime's scan can read it back. Each field is only meaningful for its
 * role: `path`/`sine` drive a mover/oscillator, `blink`/`crumbleMs` gate a
 * platform's presence, `channel` links a portal pair, `contains` sets what a
 * hittable block ejects, `launchAngle` aims a spring.
 */
export interface PlacementMeta {
  /** mover platform (T1e): straight A↔B ping-pong path, page-space, speed px/s. */
  path?: { ax: number; ay: number; bx: number; by: number; speed: number }
  /** oscillator (T1d): sin along an axis. */
  sine?: { amplitude: number; frequency: number; axis: 'x' | 'y'; phase?: number }
  /** blink platform (T1f): solid onMs, gone offMs, phaseMs stagger. */
  blink?: { onMs: number; offMs: number; phaseMs?: number }
  /** crumble platform (T1f): drops out this many ms after the player stands on it. */
  crumbleMs?: number
  /** portal (T1c): pairs are linked by matching channel. */
  channel?: number
  /** hittable block (T1b): 'token' ejects a coin above; null just breaks. */
  contains?: 'token' | null
  /** spring (T1a): launch direction in degrees (0 = straight up; +right, -left). */
  launchAngle?: number
}

export interface Placement {
  role: Role
  x: number
  y: number
  w?: number
  h?: number
  /** Tier-1 behavior config, stamped onto the shape's meta (see PlacementMeta). */
  meta?: PlacementMeta
}

/**
 * A small, winnable platformer, authored on the 60px tile grid (see roles.ts →
 * TILE) and sized around the DEFAULT PLAYER — the drawn builder, 1 tile wide × 2
 * tiles tall (60×120). Every obstacle is scaled to what that 1×2 body can do with
 * the shipped physics (`PHYSICS_DEFAULTS`: moveSpeed 340, jumpSpeed 860): a jump
 * clears roughly a **2-tile gap and a 2-tile rise**, so gaps are 2 tiles wide and
 * climbs step up 2 tiles at a time onto platforms at least 2 tiles wide (a full
 * player-width of landing).
 *
 * It reads left→right as one progression: start on the ground → hop a token →
 * jump a 2-tile gap with a hazard in it → run past a patrolling enemy (stomp or
 * dodge) → up-and-over a spring-assisted 2-tile ledge → climb two 2-tile steps,
 * a token on each → cross a one-way platform → reach the raised finish platform
 * with a checkpoint and the goal.
 *
 * Positions/sizes are whole/half tile multiples via `tiles()`; the ground top is
 * y=480 (tile row 8). The player and goal are 2 tiles tall, so anything that
 * stands ON a surface whose top is row R is placed at `y = T(R - 2)`. Tokens
 * (½ tile) sit ~1½ tiles above a surface — within the jump arc, so they're
 * grabbed in passing, not out of reach.
 */
const T = tiles
export const DEFAULT_LEVEL: Placement[] = [
  // ── Ground: two runs split by a 2-tile gap (x9→x11) the player jumps ───────
  { role: 'wall', x: T(0), y: T(8), w: T(9), h: T(2) }, // left run (start + gap approach)
  { role: 'wall', x: T(11), y: T(8), w: T(13), h: T(2) }, // right run (enemy flat + climb sits on it)
  // Player on the left ground (2 tiles tall → rests on the row-8 top at y=T(6)).
  { role: 'player', x: T(1), y: T(6) },

  // A token over the opening flat to collect on the way in.
  { role: 'token', x: T(3.75), y: T(6.5) },

  // A hazard sitting in the gap on the ground line — clear it with the gap jump.
  { role: 'hazard', x: T(9.5), y: T(7.5) },
  // A token floating over the gap, dead-center of the jump arc, as the reward.
  { role: 'token', x: T(9.75), y: T(5.5) },

  // ── Past the gap: a patrolling enemy on the flat (stomp from above or dodge).
  // A one-way platform floats a jump above the flat: hop UP through it and land
  // ON top for a safe high route over the enemy, grabbing the token up there.
  { role: 'enemy', x: T(13), y: T(7) },
  { role: 'oneway', x: T(12.5), y: T(5), w: T(2), h: T(0.25) }, // land-on-top at row 5
  { role: 'token', x: T(13.25), y: T(3.5) }, // reward above the one-way

  // ── A spring to launch up onto a 2-tile-high ledge ─────────────────────────
  { role: 'spring', x: T(16), y: T(7.75) }, // on the ground, one tile wide
  { role: 'wall', x: T(17), y: T(6), w: T(3), h: T(2) }, // ledge (top row 6) the spring lifts you to
  { role: 'token', x: T(18.25), y: T(4.5) }, // reward above the ledge

  // ── Two 2-tile steps up to the finish (each a full player-height climb) ────
  { role: 'wall', x: T(20), y: T(4), w: T(2), h: T(4) }, // step 1 (top row 4)
  { role: 'token', x: T(20.75), y: T(2.5) }, // token over step 1
  { role: 'wall', x: T(22), y: T(2), w: T(2), h: T(6) }, // step 2 / finish platform (top row 2)

  // ── The finish: a checkpoint then the goal, on the top platform (row 2) ────
  { role: 'checkpoint', x: T(22.25), y: T(0.5) }, // 1½ tiles tall, stands on row-2 top (left of goal)
  { role: 'goal', x: T(23), y: T(0) }, // 2 tiles tall → rests fully on the row-2 platform (x22→24)
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
        // Merge the role's own meta (e.g. the platform's `role: 'platform'` marker
        // from shapeForRole) with the placement's Tier-1 behavior config (path/sine/
        // blink/channel/…). Both live on `meta`, so combine them — a naive spread of
        // p.meta would clobber the marker and a template platform would read as a
        // grey wall. It's plain serializable data; cast through unknown to tldraw's
        // JsonObject meta.
        const baseMeta = (base as { meta?: Record<string, unknown> }).meta ?? {}
        const mergedMeta = { ...baseMeta, ...(p.meta ?? {}) }
        editor.createShape({
          ...base,
          x: p.x,
          y: p.y,
          props: {
            ...base.props,
            ...(p.w != null ? { w: p.w } : {}),
            ...(p.h != null ? { h: p.h } : {}),
          },
          ...(Object.keys(mergedMeta).length ? { meta: mergedMeta as unknown as Record<string, never> } : {}),
        })
      }
    },
    ignoreHistory ? { history: 'ignore', ignoreShapeLock: true } : undefined,
  )
  editor.zoomToFit({ animation: { duration: 200 } })
}
