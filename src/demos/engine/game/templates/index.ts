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

/** name → template. Feeds the "New from template" menu. */
export const TEMPLATES: Record<string, Template> = {
  mario: marioLike,
  runner: autoRunner,
}

export const TEMPLATE_LIST: { key: string; template: Template }[] = [
  { key: 'mario', template: marioLike },
  { key: 'runner', template: autoRunner },
]
