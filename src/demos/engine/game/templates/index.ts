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
  level: [
    // Ground: a long floor with a gap to jump.
    { role: 'wall', x: 0, y: 460, w: 640, h: 40 },
    { role: 'wall', x: 720, y: 460, w: 900, h: 40 },
    // Player at the far left.
    { role: 'player', x: 60, y: 380 },
    // A couple of floating brick platforms (one-way so you can jump up through).
    { role: 'oneway', x: 300, y: 340, w: 160, h: 14 },
    { role: 'oneway', x: 520, y: 280, w: 160, h: 14 },
    // Coins to collect (over the platforms + past the gap).
    { role: 'token', x: 360, y: 300 },
    { role: 'token', x: 580, y: 240 },
    { role: 'token', x: 900, y: 400 },
    { role: 'token', x: 1080, y: 400 },
    // A patrolling enemy on the far ground — stomp it or dodge it.
    { role: 'enemy', x: 950, y: 420 },
    // A pipe-ish wall bump to hop over.
    { role: 'wall', x: 1240, y: 400, w: 60, h: 60 },
    // A bounce pad for a shortcut up to a high coin.
    { role: 'spring', x: 1360, y: 448 },
    { role: 'token', x: 1370, y: 180 },
    // The flag goal at the far right.
    { role: 'goal', x: 1520, y: 388 },
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
  level: [
    { role: 'player', x: 40, y: 380 },
    // A staircase of platforms with gaps.
    { role: 'wall', x: 0, y: 460, w: 260, h: 40 },
    { role: 'wall', x: 340, y: 430, w: 200, h: 30 },
    { role: 'wall', x: 620, y: 400, w: 200, h: 30 },
    { role: 'wall', x: 900, y: 430, w: 220, h: 30 },
    { role: 'wall', x: 1200, y: 460, w: 320, h: 40 },
    // A hazard in a gap to time a jump over.
    { role: 'hazard', x: 560, y: 445, w: 60, h: 20 },
    // Coins along the run.
    { role: 'token', x: 400, y: 390 },
    { role: 'token', x: 680, y: 360 },
    { role: 'token', x: 960, y: 390 },
    // A checkpoint mid-course.
    { role: 'checkpoint', x: 900, y: 366 },
    // The goal at the end.
    { role: 'goal', x: 1440, y: 388 },
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
