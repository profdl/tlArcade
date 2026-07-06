/**
 * Engine — autoLevel: prompt → a playable level (the G4 converter, PLAN §G4).
 *
 * The highest-wow, near-free converter: the runtime that "plays" a LevelLayout
 * already exists — it's `createShape` from role + position, exactly what the tray
 * and game/level.ts do. So this converter just asks Claude for a LevelLayout
 * (roles + page coords) and lays it down as native shapes. The manual editor IS
 * the tray + canvas: the result is ordinary shapes the user drags, recolors, and
 * plays like anything they placed by hand (see the engine-data-converter skill).
 *
 * Two modes:
 *  - **replace** — clear the page, generate a fresh level from the prompt alone.
 *  - **extend** — perceive the current drawing and ask Claude to add to it,
 *    returning only the NEW placements (existing shapes are left untouched).
 *
 * Coordinates are page-space, matching how tokens/walls are authored today. The
 * schema (LevelLayoutSchema) guarantees valid roles and finite numbers; we clamp
 * nothing else — a weird layout is still editable, which is the whole point.
 */
import type { Editor } from 'tldraw'
import { generate, type GenerateOptions } from './client'
import { LevelLayoutSchema, type LevelLayout } from './schemas'
import { perceive, toImageInput } from './perceive'
import { shapeForRole, ROLES, ROLE_LIST, TILE } from '../roles'

/** How generated placements land on the canvas. */
export type LevelMode = 'replace' | 'extend'

/** The ground row's top (tile row 8 → y=480), matching game/level.ts. Generated
 *  floors sit here so an AI level reads like a hand-built / template one. */
const GROUND_ROW = 8

/** Round a page value to the nearest whole tile so generated shapes land ON the
 *  grid — the same 60px grid every hand-authored level (level.ts, templates) uses.
 *  Exported for the unit test; the apply path is editor-bound and not unit-tested. */
export function snapToTile(v: number): number {
  return Math.round(v / TILE) * TILE
}

const SYSTEM =
  'You design 2D side-scrolling platformer levels as JSON. You output ONLY a JSON ' +
  'object matching the schema described in the user message — no prose, no markdown ' +
  'fences. Coordinates are in page pixels; +x is right, +y is DOWN (screen space). ' +
  'The world is a 60px SQUARE TILE GRID: every x, y, w and h you emit MUST be a ' +
  'whole multiple of 60 (a few roles are half-tile, 30 — but never off-grid). ' +
  'Design levels that are actually winnable: the player can run and jump between ' +
  'platforms, every token is reachable, and the goal sits past the challenges. ' +
  'Then USE those same tiles to evoke the requested THEME — the only building ' +
  'blocks are the roles below, so express mood through LAYOUT: e.g. a cave/dungeon ' +
  'is an ENCLOSED corridor (a wall floor AND a wall ceiling row above it, walls ' +
  'closing the sides), a tower climbs vertically, an open field is wide and flat. ' +
  'A grey "wall" is both platform and structure — build ceilings and walls from it.'

/** A description of the role vocabulary + platformer metrics, so the model places
 *  shapes that compose into a playable level (jump reach, ground height, etc). */
function levelBrief(): string {
  const roles = ROLE_LIST.map((r) => {
    const d = ROLES[r]
    const tw = d.size.w / TILE
    const th = d.size.h / TILE
    return `  - "${r}" (${d.label}): default ${tw}x${th} tiles (${d.size.w}x${d.size.h}px). ${roleHint(r)}`
  }).join('\n')
  const g = GROUND_ROW * TILE
  return (
    `Roles you can place:\n${roles}\n\n` +
    `THE TILE GRID (this is the most important rule):\n` +
    `  - 1 tile = ${TILE}px. EVERY x, y, w, h you emit must be a whole multiple of\n` +
    `    ${TILE} (a couple of roles are half-tile, ${TILE / 2}). Off-grid values look broken.\n` +
    `  - Think in tile ROWS and COLUMNS, then multiply by ${TILE}. The ground row's\n` +
    `    top is row 8 (y=${g}); build your main floor there as ONE wide wall.\n` +
    `  - A wall is 1x1 by default — STRETCH it via w/h into floors, ceilings and\n` +
    `    columns. A 12-tile floor is ONE wall (w=${12 * TILE}), never 12 stacked squares.\n\n` +
    `PLATFORMER REACH (grid units, from the shipped physics):\n` +
    `  - The player is 1 tile wide x 2 tiles tall. One jump clears a ~2-tile-wide\n` +
    `    GAP and a ~2-tile RISE. So make gaps ~2 tiles, and step platforms up ~2\n` +
    `    tiles at a time, each landing platform at least 2 tiles wide.\n` +
    `  - A shape that STANDS on a surface whose top is row R goes at y = (R-2)*${TILE}\n` +
    `    if it's 2 tiles tall (player, goal), or y = (R-h)*${TILE} in general.\n` +
    `  - Exactly ONE player, on solid ground near the left. Every token reachable\n` +
    `    within a jump arc. The goal is the win — past the challenges, on solid ground.\n\n` +
    `THEME: build the requested mood from these tiles via LAYOUT — enclose a cave/\n` +
    `  dungeon with a ceiling wall row and side walls; go vertical for a tower; stay\n` +
    `  wide and open for a field. A screen is ~15 tiles wide x ~8 tall; extend +x.`
  )
}

function roleHint(role: string): string {
  switch (role) {
    case 'player':
      return 'the character; place on solid ground near the left. Exactly one.'
    case 'wall':
      return 'solid ground/platform; stretch via w/h into floors and ledges.'
    case 'token':
      return 'collectible; must be collected before the goal counts.'
    case 'hazard':
      return 'kills on touch (respawn); place as an obstacle to jump over.'
    case 'goal':
      return 'the win; reach it after collecting all tokens.'
    case 'enemy':
      return 'a patroller that walks back and forth; stomp it from above (the player bounces), or it kills on side contact. Place on a platform for the player to hop on.'
    default:
      return ''
  }
}

/**
 * Generate a LevelLayout from a prompt. In `extend` mode, `editor` must be given
 * so the current drawing is perceived and only NEW placements are returned.
 * Does NOT touch the canvas — call applyLevelLayout to lay it down.
 */
export async function generateLevel(
  prompt: string,
  mode: LevelMode,
  editor?: Editor,
  opts?: Partial<Pick<GenerateOptions<LevelLayout>, 'signal' | 'model'>>,
): Promise<LevelLayout> {
  const brief = levelBrief()
  const shape =
    `Reply with ONLY: {"version":1,"placements":[{"role","x","y","w?","h?"}, ...]}.`

  if (mode === 'extend' && editor) {
    const ids = editor.getCurrentPageShapes().map((s) => s.id)
    const bundle = await perceive(editor, ids)
    const instruction =
      `Here is the current level (image + shapes). Extend it per this request:\n` +
      `"${prompt}"\n\nReturn ONLY the NEW placements to ADD (do not repeat existing ` +
      `shapes). ${brief}\n\n${shape}`
    return generate({
      schema: LevelLayoutSchema,
      prompt: instruction,
      system: SYSTEM,
      images: [toImageInput(bundle.png)],
      signal: opts?.signal,
      model: opts?.model,
    })
  }

  const instruction =
    `Design a fresh, winnable platformer level for this request:\n"${prompt}"\n\n` +
    `${brief}\n\n${shape}`
  return generate({
    schema: LevelLayoutSchema,
    prompt: instruction,
    system: SYSTEM,
    signal: opts?.signal,
    model: opts?.model,
  })
}

/**
 * Lay a LevelLayout onto the canvas as native shapes (same createShape path as
 * game/level.ts). `replace` clears the page first; `extend` adds to it. This is an
 * AUTHORING action (undoable) — the result is ordinary editable shapes.
 *
 * @returns the number of shapes created.
 */
export function applyLevelLayout(editor: Editor, layout: LevelLayout, mode: LevelMode): number {
  let created = 0
  editor.run(() => {
    if (mode === 'replace') {
      const ids = editor.getCurrentPageShapes().map((s) => s.id)
      if (ids.length) editor.deleteShapes(ids)
    }
    for (const p of layout.placements) {
      const base = shapeForRole(p.role)
      // Snap to the 60px grid so an AI level lands as clean as a hand-built one,
      // even if the model emitted off-grid numbers. Sizes snap too, floored to one
      // tile so a stretched wall never collapses below a usable size.
      editor.createShape({
        ...base,
        x: snapToTile(p.x),
        y: snapToTile(p.y),
        props: {
          ...base.props,
          ...(p.w != null ? { w: Math.max(TILE, snapToTile(p.w)) } : {}),
          ...(p.h != null ? { h: Math.max(TILE, snapToTile(p.h)) } : {}),
        },
      })
      created++
    }
  })
  editor.zoomToFit({ animation: { duration: 200 } })
  return created
}

/** Convenience: generate + apply in one call. Returns the shape count created. */
export async function autoLevel(
  editor: Editor,
  prompt: string,
  mode: LevelMode,
  opts?: Partial<Pick<GenerateOptions<LevelLayout>, 'signal' | 'model'>>,
): Promise<number> {
  const layout = await generateLevel(prompt, mode, editor, opts)
  return applyLevelLayout(editor, layout, mode)
}
