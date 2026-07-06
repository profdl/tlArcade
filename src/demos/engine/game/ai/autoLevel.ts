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
import { shapeForRole, ROLES, ROLE_LIST } from '../roles'

/** How generated placements land on the canvas. */
export type LevelMode = 'replace' | 'extend'

const SYSTEM =
  'You design 2D side-scrolling platformer levels as JSON. You output ONLY a JSON ' +
  'object matching the schema described in the user message — no prose, no markdown ' +
  'fences. Coordinates are in page pixels; +x is right, +y is DOWN (screen space). ' +
  'Design levels that are actually winnable: the player can run and jump between ' +
  'platforms, every token is reachable, and the goal sits past the challenges.'

/** A description of the role vocabulary + platformer metrics, so the model places
 *  shapes that compose into a playable level (jump reach, ground height, etc). */
function levelBrief(): string {
  const roles = ROLE_LIST.map((r) => {
    const d = ROLES[r]
    return `  - "${r}" (${d.label}): default size ${d.size.w}x${d.size.h}. ${roleHint(r)}`
  }).join('\n')
  return (
    `Roles you can place:\n${roles}\n\n` +
    `Platformer metrics to respect:\n` +
    `  - The player is ~40x48 px and can jump ~150 px high and clear ~220 px gaps.\n` +
    `  - Put walls (platforms/ground) so the player can always reach the next one.\n` +
    `  - There must be exactly ONE player. Every token must be reachable. The goal\n` +
    `    is the win — place it past the level, on solid ground.\n` +
    `  - A typical screen is ~900 wide x ~500 tall; multi-screen levels extend +x.`
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
