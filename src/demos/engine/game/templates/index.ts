/**
 * Engine — bundled starter games (templates; PLAN §5.5).
 *
 * A template is FROZEN data — a level layout (Placement[]) + session rules — built
 * entirely from primitives the engine already plays (roles, the N-entity sim, the
 * session). No new engine code: a template is just "AI-shaped data with no AI in
 * the loop", the clearest demo of "author data → the runtime plays it". Each is
 * also the exit test for the tier that unlocked it (§5.5): the auto-runner and
 * Mario-1-1-like are v1's.
 *
 * They load through the same createShape path as the default level (game/level.ts
 * → loadLevel), so the result is ordinary editable shapes the user can hand-tweak.
 */
import type { Placement } from '../level'
import { tiles as T } from '../roles'
import type { SessionRules } from '../session/session'

export interface Template {
  name: string
  blurb: string
  level: Placement[]
  rules: SessionRules
}

// ── Mario-1-1-like — the flagship v1 exit test ─────────────────────────────
// Run/jump feel + a patrol/stomp enemy + platforms/coins + a flag goal, framed by
// the follow camera. Multi-screen (extends right), so it exercises the camera.
const marioLike: Template = {
  name: 'Mario 1-1',
  blurb: 'Run, jump, stomp a Goomba, grab the coins, reach the flag.',
  // Authored on the 60px tile grid (roles.ts → TILE). Ground top at y=480.
  level: [
    // Ground: a long floor (2 tiles tall) with a 2-tile gap to jump.
    { role: 'wall', x: T(0), y: T(8), w: T(11), h: T(2) },
    { role: 'wall', x: T(13), y: T(8), w: T(15), h: T(2) },
    // Player at the far left, standing on the ground.
    { role: 'player', x: T(1), y: T(6) },
    // A couple of floating brick platforms (one-way so you can jump up through).
    { role: 'oneway', x: T(5), y: T(6) },
    { role: 'oneway', x: T(9), y: T(5) },
    // Coins to collect (over the platforms + past the gap).
    { role: 'token', x: T(5.75), y: T(5.25) },
    { role: 'token', x: T(9.75), y: T(4.25) },
    { role: 'token', x: T(15), y: T(7) },
    { role: 'token', x: T(18), y: T(7) },
    // A patrolling enemy on the far ground — stomp it or dodge it.
    { role: 'enemy', x: T(16), y: T(7) },
    // A pipe-ish wall bump (2 tiles tall) to hop over.
    { role: 'wall', x: T(21), y: T(6), w: T(1), h: T(2) },
    // A bounce pad for a shortcut up to a high coin.
    { role: 'spring', x: T(23), y: T(7.75) },
    { role: 'token', x: T(23.25), y: T(3) },
    // The flag goal at the far right (2 tiles tall).
    { role: 'goal', x: T(26), y: T(6) },
  ],
  rules: {
    lives: 3,
    tokenScore: 100,
    stompScore: 200,
    timeBonusPerSec: 0,
  },
}

// ── Auto-runner / Flappy — the cheapest v1 template ────────────────────────
// A tuned-feel warm-up: a short course of platforms + one hazard + coins + goal,
// with a strict-ish life count. (A constant forward vx is a later G5 tunable; for
// now it's a hand-run course that still proves level + feel + flow + camera.)
const autoRunner: Template = {
  name: 'Runner',
  blurb: 'A quick dash: hop the gaps and the hazard, grab coins, reach the goal.',
  // Authored on the 60px tile grid (roles.ts → TILE). Landings step up by a tile.
  level: [
    { role: 'player', x: T(1), y: T(6) },
    // A staircase of platforms with gaps, each landing one tile higher then back.
    { role: 'wall', x: T(0), y: T(8), w: T(4), h: T(2) },
    { role: 'wall', x: T(6), y: T(7), w: T(3), h: T(3) },
    { role: 'wall', x: T(11), y: T(6), w: T(3), h: T(4) },
    { role: 'wall', x: T(16), y: T(7), w: T(3), h: T(3) },
    { role: 'wall', x: T(21), y: T(8), w: T(6), h: T(2) },
    // A hazard in a gap to time a jump over (1 tile wide, half tall).
    { role: 'hazard', x: T(9.5), y: T(7.5) },
    // Coins along the run.
    { role: 'token', x: T(7), y: T(6) },
    { role: 'token', x: T(12), y: T(5) },
    { role: 'token', x: T(17), y: T(6) },
    // A checkpoint mid-course, standing on the middle platform.
    { role: 'checkpoint', x: T(12), y: T(4.5) },
    // The goal at the end (2 tiles tall).
    { role: 'goal', x: T(25), y: T(6) },
  ],
  rules: {
    lives: 5,
    tokenScore: 150,
    stompScore: 200,
    timeLimitMs: 60_000, // a gentle 60s to finish
    timeBonusPerSec: 5,
  },
}

// ── Underground — the Tier-1 exit test (PLAN §4.7) ─────────────────────────
// An ORIGINAL underground layout built from our blocks, capturing the design DNA
// of the classic 2D-platformer "underground" beat — NOT a copy of any specific
// level's map/art. It exercises the new Tier-1 primitives together: an enclosed
// corridor (floor + ceiling), hittable ?-blocks you bonk for coins (T1b), a warp
// pipe to a coin alcove and back (T1c), an oscillating hazard-plant rising from a
// gap (T1d), and REAL bottomless-pit deaths (T0).
const underground: Template = {
  name: 'Underground',
  blurb: 'Drop underground: bonk blocks for coins, warp through a pipe, dodge a rising plant, hop the pits.',
  // 60px tile grid; ground top at y=T(8). A ceiling wall row makes it read as a
  // tunnel (the level.ts / autoLevel "theme through layout" language).
  level: [
    // Player at the far left on the entry floor.
    { role: 'player', x: T(1), y: T(6) },
    // ── Enclosed corridor: a ceiling row across the top, floor below ──────────
    { role: 'wall', x: T(0), y: T(0), w: T(30), h: T(1) }, // ceiling
    // Ground floor in runs split by two pits (bottomless — T0 kill-plane).
    { role: 'wall', x: T(0), y: T(8), w: T(8), h: T(2) }, // entry run
    { role: 'wall', x: T(10), y: T(8), w: T(9), h: T(2) }, // middle run (pit x8→x10)
    { role: 'wall', x: T(21), y: T(8), w: T(9), h: T(2) }, // finish run (pit x19→x21)

    // ── A row of hittable ?-blocks to bonk from below (T1b) ───────────────────
    // At head height over the entry run — jump up into them to eject coins.
    { role: 'block', x: T(3), y: T(4), meta: { contains: 'token' } },
    { role: 'block', x: T(4), y: T(4), meta: { contains: 'token' } },
    { role: 'block', x: T(5), y: T(4), meta: { contains: null } }, // just breaks

    // ── A warp pipe (T1c): channel 1 by the first pit → a coin alcove up top ──
    { role: 'portal', x: T(7), y: T(6), meta: { channel: 1 } }, // enter here
    { role: 'portal', x: T(11), y: T(2), meta: { channel: 1 } }, // arrive up on a ledge
    { role: 'oneway', x: T(10.5), y: T(4), w: T(3), h: T(0.25) }, // the alcove ledge
    { role: 'token', x: T(11.25), y: T(2.5) }, // coin reward in the alcove
    { role: 'token', x: T(12.25), y: T(2.5) },

    // ── An oscillating plant hazard rising from a gap in the middle run (T1d) ─
    // A violet enemy on a vertical sine — rises and falls like a pipe-plant. Stomp
    // it from above at the top of a jump, or time your run past while it's down.
    {
      role: 'enemy',
      x: T(15),
      y: T(6),
      meta: { sine: { amplitude: T(1.5), frequency: 0.4, axis: 'y' } },
    },
    // A coin to grab as you clear the plant.
    { role: 'token', x: T(16.5), y: T(6) },

    // ── The finish: a checkpoint then the goal on the last run ────────────────
    { role: 'checkpoint', x: T(22), y: T(6.5) },
    { role: 'goal', x: T(28), y: T(6) },
  ],
  rules: {
    lives: 3,
    tokenScore: 100,
    stompScore: 200,
    timeBonusPerSec: 0,
  },
}

// ── Factory — the Tier-1 exit test (PLAN §4.7) ─────────────────────────────
// An ORIGINAL "run-and-jump factory" layout, capturing the DNA of a Mega-Man-style
// platforming stage (the platforming HALF — shooting is Tier 2). Exercises the
// mover/blink primitives together: a moving-platform crossing over a bottomless pit
// (T1e), a blink-platform gauntlet that appears and vanishes on a clock (T1f), an
// angled spring launching up-and-across (T1a), a patrol enemy, and a checkpoint
// before the climax. NOT a copy of any specific level.
const factory: Template = {
  name: 'Factory',
  blurb: 'Cross the moving platform, time the blinking blocks, spring the gap, reach the core.',
  level: [
    { role: 'player', x: T(1), y: T(6) },
    // ── Start ledge, then a wide bottomless pit crossed by a moving platform ──
    { role: 'wall', x: T(0), y: T(8), w: T(5), h: T(2) }, // start ledge (ends x5)
    { role: 'wall', x: T(13), y: T(8), w: T(6), h: T(2) }, // far ledge (pit x5→x13)
    // A moving platform ferrying across the pit, left↔right (T1e). Ride it over.
    {
      role: 'platform',
      x: T(6),
      y: T(7),
      meta: { path: { ax: T(6), ay: T(7), bx: T(11), by: T(7), speed: 90 } },
    },
    { role: 'token', x: T(9), y: T(5.5) }, // a coin mid-crossing (grab in passing)

    // ── A blink-platform gauntlet (T1f): three pads phasing on/off over a pit ──
    // Alternating phases so you cross as each appears. The floor under them is a pit.
    { role: 'platform', x: T(19), y: T(6), w: T(1.5), h: T(0.5), meta: { blink: { onMs: 1400, offMs: 900, phaseMs: 0 } } },
    { role: 'platform', x: T(21.5), y: T(6), w: T(1.5), h: T(0.5), meta: { blink: { onMs: 1400, offMs: 900, phaseMs: 1150 } } },
    { role: 'platform', x: T(24), y: T(6), w: T(1.5), h: T(0.5), meta: { blink: { onMs: 1400, offMs: 900, phaseMs: 0 } } },
    // A crumble pad just past the gauntlet — stand and go, it drops out (T1f).
    { role: 'platform', x: T(26.5), y: T(6), w: T(1.5), h: T(0.5), meta: { crumbleMs: 700 } },
    { role: 'checkpoint', x: T(21), y: T(4.5) }, // mid-gauntlet checkpoint (on a pad)

    // ── Landing ledge past the gauntlet, a patrol enemy, then an angled spring ─
    { role: 'wall', x: T(28), y: T(8), w: T(6), h: T(2) },
    { role: 'enemy', x: T(30), y: T(7) }, // a patroller on the ledge
    // An angled spring (T1a) launching up-and-right onto the raised core platform.
    { role: 'spring', x: T(33), y: T(7.75), meta: { launchAngle: 30 } },
    { role: 'wall', x: T(35), y: T(4), w: T(5), h: T(6) }, // raised core platform (top row 4)
    { role: 'token', x: T(36), y: T(2.5) },
    { role: 'token', x: T(37), y: T(2.5) },
    // The goal (the "core") on the raised platform.
    { role: 'goal', x: T(38), y: T(2) },
  ],
  rules: {
    lives: 5,
    tokenScore: 150,
    stompScore: 200,
    timeBonusPerSec: 0,
  },
}

/** name → template. Feeds the "New from template" menu. */
export const TEMPLATES: Record<string, Template> = {
  mario: marioLike,
  runner: autoRunner,
  underground,
  factory,
}

export const TEMPLATE_LIST: { key: string; template: Template }[] = [
  { key: 'mario', template: marioLike },
  { key: 'runner', template: autoRunner },
  { key: 'underground', template: underground },
  { key: 'factory', template: factory },
]
