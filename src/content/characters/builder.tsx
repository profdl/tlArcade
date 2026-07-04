/**
 * Builder scene characters — proof of a THIRD render axis.
 * --------------------------------------------------------
 * `brick` renders as a NATIVE tldraw rectangle (render: 'rect'), not a doodle
 * sprite — so the wall the builder stacks is real, editable tldraw content. The
 * `builder` is an ordinary sprite whose behavior (fetch → carry → stack) lives
 * in sim/systems.ts → builderSystem, opted into by the Builder scene's pipeline.
 */
import { seg, poly, ring, s } from '../../render/freehand'
import { Icon } from '../../render/icons'
import { MOVE } from '../../sim/config'
import { randFloat } from '../../sim/rng'
import type { Vec2 } from '../../sim/components'
import type { CharacterDef, SvgArtPart } from './types'
import { VAN_ART } from './busytown'
import { pickUnique } from './speech'

const clone = (at: Vec2): Vec2 => ({ x: at.x, y: at.y })

// ── worker & truck barb pools (portentous construction-site philosophy) ──────
// The crew and the delivery truck never shut up: they narrate the job in the
// register of Žižek and Herzog (with the odd Diogenes / Camus / Baudrillard
// aside). Lines are grouped by the state that shows them, and picked with a
// stable seed so a bubble never flickers between lines frame to frame — it only
// rotates when the seed advances (a brick is placed, a new break begins, a
// fresh delivery starts). Pools are deliberately large so a three- or four-snail
// crew reads as a rambling seminar, not an echo.
//
// pickUnique() (speech.ts) hands out a line the pool has NOT already spoken —
// town-wide, until the pool is exhausted and recycles — so two snails never echo
// the same barb and a line doesn't recur while fresh ones remain. It still keeps
// each stable seed pinned to one line (no per-frame flicker).

// Out of bricks, loitering in the break area — pure theory, no labor.
const REST_LINES = [
  'The delay itself is the ideology.',
  'No big Other hands out bricks.',
  'And so on… the brick never arrives.',
  'We wait, and the waiting builds us.',
  'The absent brick is the truest brick.',
  'To rest is to resist the wall’s demand.',
  'Nature here is vile, base, and out of mortar.',
  'The jungle would swallow this wall gladly.',
  'Even the void must clock in somewhere.',
  'Perhaps the tower does not wish to exist.',
  'The birds mock our unfinished silhouette.',
  'The overwhelming indifference of the gravel.',
  'A brick withheld reveals the whole system.',
  'Idleness is the last honest labor.',
  'So it stands: half a wall, whole an idea.',
  'I own nothing, and the pile owns less.',
]

// Walking out to fetch a brick from the pile — desire in transit.
const FETCH_LINES = [
  'To want the brick is to have it.',
  'The brick recedes as I approach — sublime.',
  'I trudge, therefore the wall persists.',
  'Somewhere ahead, a brick dreams of me.',
  'Fetching is faith without guarantee.',
  'Each step a small, ecstatic humiliation.',
  'Desire is a walk with no arrival.',
  'The distance, comrade, is the whole point.',
  'I go to meet what was always missing.',
  'One does not choose the brick; it summons.',
]

// Carrying a brick to the wall and stacking it — labor as symptom.
const STACK_LINES = [
  'Stack, and the wall wants more.',
  'Each brick a symptom, laid in mortar.',
  'The wall grows, indifferent to my back.',
  'I place it — and lack another.',
  'The tower rises like a slow, obscene hope.',
  'To build is only to postpone the collapse.',
  'Surplus enjoyment, in load-bearing form.',
  'Gravity and I have an understanding.',
  'This brick completes nothing. Excellent.',
  'Order imposed on chaos, one brick’s worth.',
]

// Parked at the factory, loading the bed — accumulation as metaphysics. (The
// truck speaks only while STOPPED — here, and at the drop below — never on the
// road, so its bubble sits still long enough to read.)
const LOAD_LINES = [
  'I fill the bed with someone’s longing.',
  'The factory births what the wall lacks.',
  'The cargo is pure promise, nothing more.',
  'These bricks believe in their destination.',
  'Loading up on other people’s desire.',
  'Each brick a promise I did not make.',
]

// The truck tipping its load onto a fresh drop point — the object arrives.
const DUMP_LINES = [
  'Enjoy the surplus… briefly.',
  'Here: the objects of your longing.',
  'A heap, and already it disappoints.',
  'I leave them to their fate. Bricks.',
  'Unloaded. The desire resumes elsewhere.',
  'Behold, gravel’s cousins, at rest.',
]

// ── worker (imported artwork skin) ─────────────────────────────────────────
// A friendly humanoid, imported as an SVG export from tldraw's own Draw tool:
// each `<g transform="matrix(1,0,0,1,tx,ty)">` is one filled shape (head, mouth,
// two arms, two legs, torso, two eyes), traced by hand at the source. Rather
// than re-sample it into freehand stroke centre-lines (which would re-draw it
// in the doodle ink style and lose the flat filled look), each group is kept
// as a literal `render: 'svg'` part: its own translate+scale into the shared
// 0–100 art box, with the original path `d` + `fill` untouched. Order matters
// — it's paint order, preserved from the export (torso is drawn AFTER the
// arms/legs so it overlaps them, eyes drawn last on top).
const WORKER_SVG: SvgArtPart[] = [
  { // head (light fill + dark outline)
    tx: 31.411, ty: 3.054, scale: 0.76852,
    paths: [
      { d: 'M 0 26.2911 C 0 11.7709 12.4127 0 27.7245 0 C 43.0363 0 55.449 11.7709 55.449 26.2911 C 55.449 40.8113 43.0363 52.5822 27.7245 52.5822 C 12.4127 52.5822 0 40.8113 0 26.2911', fill: '#fcfffe' },
      { d: 'M 0.3465 27.7958 C 1.1107 12.5331 13.5234 0.7622 28.8352 0.7622 C 43.7097 1.1757 56.1224 12.9466 56.1224 27.4668 C 55.9594 40.5123 43.5467 52.2833 28.2349 52.2833 C 12.7592 54.0869 0.3465 42.316 0.3465 27.7958 M 1.2395 27.3978 C 0.5876 10.741 13.0003 -1.0299 28.3121 -1.0299 C 42.6577 -1.1464 55.0704 10.6245 55.0704 25.1447 C 55.1492 40.5199 42.7366 52.2908 27.4247 52.2908 C 13.6522 53.6889 1.2395 41.9179 1.2395 27.3978', fill: 'none', stroke: '#1d1d1d', strokeWidth: 5 },
    ],
  },
  { // mouth
    tx: 63.111, ty: 25.557, scale: 0.76852,
    paths: [{ d: 'M3.36,1.26 t-1.09,2.75 -1.92,3.98 -3.2,3.24 -3.83,2.69 -2.83,.96 -2.97,.3 -3.09,-.55 -2.73,-1.64 -3.22,-4.3 -1.97,-3.23 a3.96,3.96 0 0 1 7.14,-3.42 t1.64,2.71 3.05,2.57 2.71,-.91 2.37,-1.73 2.15,-3.45 1.07,-2.49 a3.59,3.59 0 0 1 6.72,2.52 Z', fill: '#1d1d1d' }],
  },
  { // left arm
    tx: 39.794, ty: 47.404, scale: 0.76852,
    paths: [{ d: 'M-.89,3.45 t-2.59,-.72 -4.03,-.92 -4.72,.01 -4.76,.68 -4,2.23 -3.35,3.04 -.82,1.26 a3.93,3.93 0 0 1 -7,-3.58 t1.46,-2.17 2.59,-3.05 3.56,-2.53 5.15,-2.45 4.56,-1 4.79,-.04 6.95,1.25 3.99,1.09 a3.56,3.56 0 0 1 -1.78,6.9 Z', fill: '#1d1d1d' }],
  },
  { // right arm
    tx: 63.679, ty: 47.404, scale: 0.76852,
    paths: [{ d: 'M.25,-3.48 t4.38,.2 5.99,-.13 4.43,-1.62 4.52,-3.23 1.7,-1.93 a3.83,3.83 0 0 1 5.74,5.06 t-2.01,2.24 -4.72,3.64 -5.71,2.34 -4.69,.99 -5.91,-.27 -4.22,-.33 a3.49,3.49 0 0 1 .5,-6.96 Z', fill: '#1d1d1d' }],
  },
  { // left leg
    tx: 44.762, ty: 76.687, scale: 0.76852,
    paths: [{ d: 'M3.58,0 t0,4.06 -.84,7.09 -2.8,7.31 -4.01,7.27 -2.05,2.99 a3.92,3.92 0 0 1 -6.26,-4.72 t2.53,-3.91 4.15,-8.04 1.87,-8.09 .25,-3.96 a3.58,3.58 0 0 1 7.16,0 Z', fill: '#1d1d1d' }],
  },
  { // right leg
    tx: 58.942, ty: 74.678, scale: 0.76852,
    paths: [{ d: 'M3.54,0 t-.28,4.01 -.88,6.94 -2.53,6.92 -2.96,5.44 -1.01,1.47 a3.83,3.83 0 0 1 -6.28,-4.38 t.62,-.9 2.68,-4.83 2.44,-5.45 .75,-5.36 .37,-3.86 a3.54,3.54 0 0 1 7.08,0 Z', fill: '#1d1d1d' }],
  },
  { // torso (drawn on top of the arms/legs, per the export's paint order)
    tx: 38.759, ty: 38.744, scale: 0.76852,
    paths: [{ d: 'M2.37,0 t.08,7.99 .14,12.38 .49,9.82 .78,9.55 1.27,4.25 6.96,-.05 8.22,-.39 5.34,-.89 5.11,-1.02 1.8,-2.37 -.4,-10.11 -.68,-15.38 -.56,-8.21 -.28,-1.24 -.15,-.32 a2.56,2.56 0 0 1 4.8,-1.74 t.32,1.11 .63,6.46 .77,13.58 .49,13.42 -.26,6.23 -1.22,1.83 -2.94,1.35 -2.98,.62 -4.01,.67 -10.32,1.22 -10.16,.6 -3.8,-.29 -1.61,-1.3 -.88,-2.05 -.47,-5.02 -.8,-9.93 -.54,-10.36 .04,-12.42 .08,-7.99 a2.37,2.37 0 0 1 4.74,0 Z', fill: '#1d1d1d' }],
  },
  { // left eye
    tx: 45.357, ty: 19.092, scale: 0.76852,
    paths: [{ d: 'M 0 0 m -3.18, 0 a 3.18,3.18 0 1,1 6.36,0 a 3.18,3.18 0 1,1 -6.36,0', fill: '#1d1d1d' }],
  },
  { // right eye
    tx: 63.111, ty: 16.876, scale: 0.76852,
    paths: [{ d: 'M 0 0 m -3.18, 0 a 3.18,3.18 0 1,1 6.36,0 a 3.18,3.18 0 1,1 -6.36,0', fill: '#1d1d1d' }],
  },
]

// ── hardhat (imported artwork skin — the DEFAULT look) ──────────────────────
// A construction worker in a hard hat and a hi-vis vest (orange block + four
// yellow reflective stripes), legs splayed in a sturdy stance. Same import
// path as WORKER_SVG — one `<g transform>` per traced shape — but several
// groups here ROTATE (the tilted helmet, the two splayed legs), so those parts
// carry a full 6-value `matrix` [a,b,c,d,e,f] instead of the tx/ty/scale
// shorthand (see content/characters/types.ts → SvgArtPart). Paint order is the
// export's: vest block first so the dark torso outline overlaps it, hat last so
// it sits on top of the head.
export const HARDHAT_SVG: SvgArtPart[] = [
  { // vest (hi-vis body block, drawn first so the torso outline sits on it)
    matrix: [0.6869, 0, 0, 0.6869, 40.4702, 47.9172],
    paths: [
      { d: 'M 4 0 L 28.7956 0 Q 32.7956 0 32.7956 4 L 32.7956 24.0106 Q 32.7956 28.0106 28.7956 28.0106 L 4 28.0106 Q 0 28.0106 0 24.0106 L 0 4 Q 0 0 4 0', fill: '#e16919' },
      { d: 'M 3.9989 -0.1565 L 28.8804 -0.6087 Q 32.8804 -0.6087 32.8804 3.3913 L 32.7567 24.204 Q 32.7567 28.204 28.7567 28.204 L 4.3616 28.4413 Q 0.3616 28.4413 0.3616 24.4413 L -0.0011 3.8435 Q -0.0011 -0.1565 3.9989 -0.1565 M 3.7337 -0.0721 L 29.2138 0.5179 Q 33.2138 0.5179 33.2138 4.5179 L 32.937 23.7293 Q 32.937 27.7293 28.937 27.7293 L 3.691 28.381 Q -0.309 28.381 -0.309 24.381 L -0.2663 3.9279 Q -0.2663 -0.0721 3.7337 -0.0721', fill: 'none', stroke: '#e16919', strokeWidth: 2 },
    ],
  },
  { // vest stripe: left vertical
    matrix: [0.6869, 0, 0, 0.6869, 46.9368, 49.9564],
    paths: [
      { d: 'M2.28,0 t-.04,4.47 -.07,11.33 .18,7.77 .22,.93 a2.56,2.56 0 0 1 -4.7,2.04 t-.4,-1.94 -.22,-8.48 .33,-11.33 .14,-4.79 a2.28,2.28 0 0 1 4.56,0 Z', fill: '#f1ac4b' },
    ],
  },
  { // vest stripe: right vertical
    matrix: [0.6869, 0, 0, 0.6869, 55.5411, 49.9936],
    paths: [
      { d: 'M2.2,-.2 t1.03,7.6 1.4,12.5 .36,4.9 a2.52,2.52 0 0 1 -5.02,.43 t-.4,-7.55 -1.08,-12.52 -.69,-4.96 a2.21,2.21 0 0 1 4.4,-.4 Z', fill: '#f1ac4b' },
    ],
  },
  { // vest stripe: top horizontal
    matrix: [0.6869, 0, 0, 0.6869, 41.7524, 68.0262],
    paths: [
      { d: 'M0,-2.31 t3.57,0 3.47,-.2 -.11,-.2 a2.51,2.51 0 0 1 1.68,4.74 t-1.67,.21 -4.3,.15 -2.64,-.08 a2.31,2.31 0 0 1 0,-4.62 Z', fill: '#f1ac4b' },
    ],
  },
  { // vest stripe: bottom horizontal
    matrix: [0.6869, 0, 0, 0.6869, 57.4937, 67.632],
    paths: [
      { d: 'M0,-2.3 t2.62,-.08 3.13,-.25 .51,-.16 a2.5,2.5 0 0 1 1.98,4.58 t-1.5,.34 -4.12,.25 -2.62,-.08 a2.3,2.3 0 0 1 0,-4.6 Z', fill: '#f1ac4b' },
    ],
  },
  { // head (light fill + dark outline)
    matrix: [0.6869, 0, 0, 0.6869, 33.3838, 13.0155],
    paths: [
      { d: 'M 0 26.2911 C 0 11.7709 12.4127 0 27.7245 0 C 43.0363 0 55.449 11.7709 55.449 26.2911 C 55.449 40.8113 43.0363 52.5822 27.7245 52.5822 C 12.4127 52.5822 0 40.8113 0 26.2911', fill: '#fcfffe' },
      { d: 'M -1.1435 26.1146 C -0.4744 12.0896 11.9383 0.3187 27.2501 0.3187 C 43.4269 -0.6733 55.8396 11.0977 55.8396 25.6178 C 54.5831 41.2594 42.1704 53.0304 26.8586 53.0304 C 11.2692 52.4057 -1.1435 40.6348 -1.1435 26.1146 M -0.8447 25.7309 C -0.7793 11.6812 11.6334 -0.0898 26.9452 -0.0898 C 42.5292 0.1019 54.9418 11.8729 54.9418 26.393 C 56.4978 40.9716 44.0851 52.7425 28.7733 52.7425 C 11.568 52.022 -0.8447 40.2511 -0.8447 25.7309', fill: 'none', stroke: '#1d1d1d', strokeWidth: 5 },
    ],
  },
  { // mouth
    matrix: [0.6869, 0, 0, 0.6869, 61.7191, 33.1292],
    paths: [
      { d: 'M3.36,1.26 t-1.09,2.75 -1.92,3.98 -3.2,3.24 -3.83,2.69 -2.83,.96 -2.97,.3 -3.09,-.55 -2.73,-1.64 -3.22,-4.3 -1.97,-3.23 a3.96,3.96 0 0 1 7.14,-3.42 t1.64,2.71 3.05,2.57 2.71,-.91 2.37,-1.73 2.15,-3.45 1.07,-2.49 a3.59,3.59 0 0 1 6.72,2.52 Z', fill: '#1d1d1d' },
    ],
  },
  { // left arm
    matrix: [0.6869, 0, 0, 0.6869, 40.8777, 52.6576],
    paths: [
      { d: 'M-.89,3.45 t-2.59,-.72 -4.03,-.92 -4.72,.01 -4.76,.68 -4,2.23 -3.35,3.04 -.82,1.26 a3.93,3.93 0 0 1 -7,-3.58 t1.46,-2.17 2.59,-3.05 3.56,-2.53 5.15,-2.45 4.56,-1 4.79,-.04 6.95,1.25 3.99,1.09 a3.56,3.56 0 0 1 -1.78,6.9 Z', fill: '#1d1d1d' },
    ],
  },
  { // right arm
    matrix: [0.6869, 0, 0, 0.6869, 62.227, 52.6576],
    paths: [
      { d: 'M.25,-3.48 t4.38,.2 5.99,-.13 4.43,-1.62 4.52,-3.23 1.7,-1.93 a3.83,3.83 0 0 1 5.74,5.06 t-2.01,2.24 -4.72,3.64 -5.71,2.34 -4.69,.99 -5.91,-.27 -4.22,-.33 a3.49,3.49 0 0 1 .5,-6.96 Z', fill: '#1d1d1d' },
    ],
  },
  { // right leg (splayed — rotated group)
    matrix: [0.6121, -0.3119, 0.3119, 0.6121, 60.4394, 77.0367],
    paths: [
      { d: 'M3.58,0 t0,4.06 -.84,7.09 -2.8,7.31 -4.01,7.27 -2.05,2.99 a3.92,3.92 0 0 1 -6.26,-4.72 t2.53,-3.91 4.15,-8.04 1.87,-8.09 .25,-3.96 a3.58,3.58 0 0 1 7.16,0 Z', fill: '#1d1d1d' },
    ],
  },
  { // left leg (splayed — rotated group)
    matrix: [0.6604, -0.1893, 0.1893, 0.6604, 46.4082, 78.1699],
    paths: [
      { d: 'M3.58,0 t0,4.06 -.84,7.09 -2.8,7.31 -4.01,7.27 -2.05,2.99 a3.92,3.92 0 0 1 -6.26,-4.72 t2.53,-3.91 4.15,-8.04 1.87,-8.09 .25,-3.96 a3.58,3.58 0 0 1 7.16,0 Z', fill: '#1d1d1d' },
    ],
  },
  { // torso (dark body outline, over the vest)
    matrix: [0.6869, 0, 0, 0.6869, 39.9522, 44.9163],
    paths: [
      { d: 'M2.37,0 t.08,7.99 .14,12.38 .49,9.82 .78,9.55 1.27,4.25 6.96,-.05 8.22,-.39 5.34,-.89 5.11,-1.02 1.8,-2.37 -.4,-10.11 -.68,-15.38 -.56,-8.21 -.28,-1.24 -.15,-.32 a2.56,2.56 0 0 1 4.8,-1.74 t.32,1.11 .63,6.46 .77,13.58 .49,13.42 -.26,6.23 -1.22,1.83 -2.94,1.35 -2.98,.62 -4.01,.67 -10.32,1.22 -10.16,.6 -3.8,-.29 -1.61,-1.3 -.88,-2.05 -.47,-5.02 -.8,-9.93 -.54,-10.36 .04,-12.42 .08,-7.99 a2.37,2.37 0 0 1 4.74,0 Z', fill: '#1d1d1d' },
    ],
  },
  { // left eye
    matrix: [0.6869, 0, 0, 0.6869, 45.8499, 27.3506],
    paths: [
      { d: 'M 0 0 m -3.18, 0 a 3.18,3.18 0 1,1 6.36,0 a 3.18,3.18 0 1,1 -6.36,0', fill: '#1d1d1d' },
    ],
  },
  { // right eye
    matrix: [0.6869, 0, 0, 0.6869, 61.7191, 25.3697],
    paths: [
      { d: 'M 0 0 m -3.18, 0 a 3.18,3.18 0 1,1 6.36,0 a 3.18,3.18 0 1,1 -6.36,0', fill: '#1d1d1d' },
    ],
  },
  { // hard hat: dome + brim (rotated)
    matrix: [0.6765, -0.1193, 0.1193, 0.6765, 37.6004, 15.9483],
    paths: [
      { d: 'M.71,0 q.71,0 1.28,0 t1.06,0 .94,0 .88,0 .84,0 .79,0 .73,0 .64,0 .51,0 .42,0 .38,0 .36,0 .36,0 .38,-.02 .4,-.05 .42,-.06 .41,-.06 .41,-.05 .42,-.05 .39,-.06 .4,-.05 .47,-.04 .54,-.04 .6,-.04 .65,-.05 .7,-.03 .76,-.02 .8,-.01 .83,-.01 .84,0 .81,-.01 .76,0 .64,0 .5,0 .41,0 .34,0 .31,0 .31,0 .31,0 .32,0 .31,0 .33,0 .36,0 .36,0 .34,0 .33,0 .33,0 .34,0 .38,0 .45,0 .51,0 .54,0 .56,-.01 .56,-.03 .57,-.06 .54,-.06 .51,-.05 .43,-.05 .37,-.02 .29,-.02 .22,0 .17,-.01 .16,0 .17,0 .16,0 .15,0 .14,-.01 .14,-.03 .15,-.02 .14,-.02 .13,-.01 .12,-.03 .13,-.03 .17,-.01 .19,-.01 .18,-.01 .15,0 .11,0 .05,0 -.02,0 -.04,0 -.07,0 -.08,-.02 -.12,-.04 -.15,-.05 -.17,-.03 -.18,-.03 -.16,-.03 -.16,-.03 -.18,-.02 -.18,-.02 -.19,-.03 -.2,-.03 -.22,-.02 -.23,-.02 -.21,-.03 -.18,-.05 -.16,-.04 -.16,-.05 -.16,-.05 -.15,-.05 -.14,-.06 -.11,-.05 -.07,-.06 -.05,-.05 -.05,-.05 -.04,-.05 -.05,-.07 -.06,-.07 -.05,-.08 -.04,-.09 -.05,-.08 -.05,-.09 -.07,-.09 -.05,-.12 -.06,-.14 -.07,-.15 -.08,-.15 -.07,-.15 -.08,-.17 -.08,-.2 -.1,-.22 -.12,-.25 -.13,-.25 -.15,-.27 -.17,-.27 -.22,-.28 -.22,-.29 -.19,-.24 -.17,-.2 -.15,-.18 -.13,-.18 -.11,-.18 -.1,-.16 -.1,-.15 -.09,-.13 -.1,-.13 -.09,-.13 -.09,-.14 -.1,-.14 -.1,-.17 -.11,-.18 -.15,-.2 -.16,-.21 -.16,-.21 -.16,-.2 -.15,-.23 -.17,-.24 -.19,-.26 -.21,-.28 -.22,-.3 -.24,-.31 -.24,-.27 -.2,-.22 -.17,-.19 -.17,-.16 -.16,-.16 -.17,-.16 -.18,-.17 -.19,-.17 -.2,-.16 -.23,-.17 -.24,-.18 -.26,-.19 -.29,-.2 -.32,-.21 -.4,-.24 -.48,-.27 -.54,-.28 -.55,-.27 -.57,-.22 -.57,-.18 -.58,-.14 -.58,-.11 -.57,-.07 -.54,-.04 -.55,-.03 -.57,-.05 -.54,-.03 -.48,-.02 -.44,-.01 -.4,-.01 -.38,0 -.37,0 -.38,0 -.35,0 -.33,0 -.29,0 -.28,0 -.27,0 -.27,.01 -.28,.03 -.37,.06 -.54,.12 -.7,.17 -.82,.2 -.84,.24 -.79,.26 -.69,.27 -.59,.27 -.5,.27 -.44,.28 -.39,.29 -.31,.28 -.26,.22 -.19,.16 -.16,.15 -.16,.14 -.14,.12 -.12,.11 -.13,.12 -.13,.13 -.14,.13 -.14,.13 -.16,.12 -.16,.13 -.16,.13 -.17,.15 -.17,.19 -.15,.2 -.12,.21 -.09,.19 -.07,.18 -.06,.18 -.05,.21 -.08,.21 -.08,.23 -.09,.24 -.08,.2 -.05,.15 -.03,.12 -.01,.11 -.01,.1 0,.09 -.01,.08 0,.09 0,.08 0,.09 0,.08 0,.09 0,.08 0,.1 0,.12 -.01,.16 -.03,.18 -.06,.21 -.07,.2 -.08,.21 -.07,.21 -.05,.21 -.03,.18 -.02,.19 -.02,.17 -.03,.18 -.03,.15 -.01,.13 -.02,.11 -.02,.1 -.03,.09 -.02,.08 -.01,.09 -.03,.09 -.03,.08 -.01,.08 -.01,.08 -.01,.08 0,.08 0,.08 0,.07 0,.08 0,.08 0,.08 0,.08 0,.08 -.02,.08 -.08,.31 -.12,.58 -.12,1.03 .65,.71 Z', fill: '#e16919' },
      { d: 'M0,-2.3 t5.04,-.06 8.19,-.4 9.64,-.41 9.35,-.32 2.85,-.25 a2.61,2.61 0 0 1 .43,5.2 t-2.98,.22 -8.29,.19 -9.73,.26 -9.46,.23 -5.04,-.06 a2.3,2.3 0 0 1 0,-4.6 ZM34.82,1.43 t-1.52,-.25 -2.62,-.81 -2.06,-2.27 -2.68,-4.04 -2.43,-3.11 -1.59,-1.37 -1.73,-.99 -2.93,-.64 -4.25,-.12 -3.32,.4 -2.07,.7 -2.28,1.76 -1.98,4.9 -.65,3.55 a2.66,2.66 0 0 1 -5.2,-1.12 t.76,-3.82 1.22,-4.8 1.22,-1.67 2.36,-1.93 2.76,-1.73 3.12,-1.01 5.01,-.5 5.05,.31 3.07,.75 2,1.01 2.39,1.85 3.83,4.64 3.06,4.1 1.53,.92 .86,.15 a2.61,2.61 0 0 1 -.93,5.14 Z', fill: '#e16919' },
    ],
  },
  { // hard hat: yellow top knob
    matrix: [0.6869, 0, 0, 0.6869, 47.6477, 4.106],
    paths: [
      { d: 'M1.93,-1.3 t.98,1.66 2.04,4.62 1.33,4.63 .25,1.66 a2.51,2.51 0 0 1 -5,.14 t.11,-.19 -.21,-1.38 -.94,-3.15 -1.53,-3.68 -.89,-1.71 a2.33,2.33 0 0 1 3.86,-2.6 Z', fill: '#f1ac4b' },
    ],
  },
  { // hard hat: dark outline (rotated)
    matrix: [0.6765, -0.1193, 0.1193, 0.6765, 35.5618, 16.2106],
    paths: [
      { d: 'M-2.39,0 t.08,-3.81 .31,-4.9 1.32,-2.85 1.77,-2.48 1.56,-1.4 3.6,-1.87 3.71,-1.47 3.14,-.41 7.29,-.08 6.12,.37 2.76,1.37 3.16,2.52 3.04,3.92 2.41,3.11 1.63,1.1 2.09,.76 2.04,1.06 1.4,1.55 .78,1.83 -.07,2 -.97,1.65 -1.58,1.17 -2.88,.9 -9.34,.22 -12.36,-.18 -10.02,.4 -6.58,.11 -1.59,-.29 a2.65,2.65 0 0 1 1.6,-5.06 t.91,.16 7.2,-.28 12.65,-.26 11.54,.07 6.12,-.57 .09,.08 -2.65,-.22 -3.31,-2.05 -3.79,-4.54 -4.02,-4.38 -2.66,-1.21 -6.17,-.08 -6.2,.24 -2.94,1.04 -2.91,1.45 -1.5,1.35 -1.08,1.62 -.61,1.85 -.23,3.72 -.08,2.77 a2.39,2.39 0 0 1 -4.78,0 Z', fill: '#1d1d1d' },
    ],
  },
]

// ── hardhat CARRYING pose (swapped in while he's hauling a brick) ───────────
// Same imported figure as HARDHAT_SVG, re-posed from a second tldraw export: the
// smile becomes a strained grimace, the brows knit, and the right arm swings up
// and around to brace the load (the brick itself is a separate rect the sim
// hugs low against the body — see the hardhat skin's `carryOffset`). Only the
// parts that MOVE are respecified; everything else (head, vest, hat, torso,
// eyes, left arm, and crucially the two legs at indices 9 & 10) is reused
// untouched so the walk rig keeps swinging them. New facial parts (knitted
// brows) are appended AFTER the hat so they read on top of the face. The box-
// space transforms were derived from the export by matching its unchanged
// shapes (vest/head/torso) back onto HARDHAT_SVG's 0–100 art box.
const HARDHAT_CARRY_MOUTH: SvgArtPart = { // strained grimace (replaces the smile)
  matrix: [0.6869, 0, 0, 0.6869, 48.9394, 40.5989],
  paths: [{ d: 'M-2.21,-.79 t1.46,-3.42 1.92,-4.1 .47,-.68 a2.48,2.48 0 0 1 4,2.92 t-.54,.82 -1.72,3.43 -1.17,2.61 a2.35,2.35 0 0 1 -4.42,-1.58 ZM5.78,-8.77 t1.07,1.54 2.34,2.44 1.26,.89 a2.54,2.54 0 0 1 -2.79,4.26 t-1.24,-.86 -2.24,-1.85 -1.85,-2.46 -.84,-1.49 a2.48,2.48 0 0 1 4.29,-2.47 ZM6.61,-2.47 t.2,-.73 2.26,-4.7 2.94,-4.72 2.07,-.66 1.99,.79 2.58,1.27 1.77,.55 a2.57,2.57 0 0 1 -1.29,4.97 t-1.06,-.21 -2.08,-.59 -1.96,-1.3 .13,-1.19 -.61,3.28 -1.88,4.09 -.17,.56 a2.54,2.54 0 0 1 -4.89,-1.41 ZM17.21,-8.3 t.24,-1.55 1.29,-3.38 1.04,-1.83 a2.6,2.6 0 0 1 4.62,2.4 t-.99,1.6 -1.03,2.29 -.04,.7 a2.57,2.57 0 0 1 -5.13,-.23 Z', fill: '#1d1d1d' }],
}
const HARDHAT_CARRY_ARM: SvgArtPart = { // right arm raised/rotated to brace the brick
  matrix: [0.66348, 0.17777, -0.17777, 0.66348, 86.0345, 53.1197],
  paths: [{ d: 'M-.89,3.45 t-2.59,-.72 -4.03,-.92 -4.72,.01 -4.76,.68 -4,2.23 -3.35,3.04 -.82,1.26 a3.93,3.93 0 0 1 -7,-3.58 t1.46,-2.17 2.59,-3.05 3.56,-2.53 5.15,-2.45 4.56,-1 4.79,-.04 6.95,1.25 3.99,1.09 a3.56,3.56 0 0 1 -1.78,6.9 Z', fill: '#1d1d1d' }],
}
const BROW_D = 'M-1.33,-1.86 t.44,-.33 2.17,-2.32 1.74,-1.99 a2.47,2.47 0 0 1 3.5,3.5 t-1.38,1.45 -2.6,2.43 -1.21,.98 a2.29,2.29 0 0 1 -2.66,-3.72 Z'
const HARDHAT_CARRY_BROWS: SvgArtPart[] = [
  { matrix: [0.6869, 0, 0, 0.6869, 42.2161, 25.9680], paths: [{ d: BROW_D, fill: '#1d1d1d' }] }, // left brow
  { matrix: [0.56271, 0.39401, -0.39401, 0.56271, 57.6203, 24.6880], paths: [{ d: BROW_D, fill: '#1d1d1d' }] }, // right brow (knit)
]
// Reuse every unchanged part in place (so leg indices 9 & 10 still line up with
// the walk rig); swap only the mouth (6) and right arm (8), then add the brows.
const HARDHAT_CARRY_SVG: SvgArtPart[] = [
  ...HARDHAT_SVG.map((p, i) => (i === 6 ? HARDHAT_CARRY_MOUTH : i === 8 ? HARDHAT_CARRY_ARM : p)),
  ...HARDHAT_CARRY_BROWS,
]

// ── builder (three swappable skins: hard-hat worker · plain worker · snail) ──
// The kind ships THREE appearances the player cycles from the HUD, with the
// hard-hat construction worker (HARDHAT_SVG) as the default. Behavior is
// unchanged across skins — kind stays 'builder' regardless of which is active,
// so builderSystem (fetch → carry → stack) and the Builder scene roster never
// need to know which art is currently showing.
//   • hardhat / worker — imported filled artwork (render: 'svg'); their pose
//     reads front-on, not left/right, so they carry no walk rig and never flip.
//   • snail — a hand-inked doodle traced from a reference snail drawn with
//     tldraw's pen (points sampled from the draw shapes, normalized into the
//     0–100 box). It reads as one figure because the strokes are CONTINUOUS the
//     way a pen draws them: the shell coil flows straight into the neck, and the
//     outer body is a single unbroken silhouette (head → front → belly → foot)
//     closed by the sole's upper edge back at the tail. It glides rather than
//     walks — an EMPTY walk-rig limb list keeps only the facing-flip (turns to
//     face travel) with no leg swing. Drawn facing RIGHT — head and eye on the
//     right.
const builder: CharacterDef = {
  kind: 'builder',
  size: 100,
  color: 'black',
  defaultSkin: 'hardhat',
  skins: {
    hardhat: {
      label: 'Hard Hat',
      render: 'svg',
      svg: HARDHAT_SVG,
      // While hauling a brick he swaps to a straining pose (grimace + knit brows
      // + a braced right arm) and hugs the brick low against his body rather than
      // floating it overhead — see HARDHAT_CARRY_SVG and carryOffset.
      svgCarry: HARDHAT_CARRY_SVG,
      carryOffset: { x: 7.5, y: 18 },
      // He walks: the two legs (svg parts 9 = right, 10 = left) swing in
      // alternating phase about their hips while moving, and the whole figure
      // mirrors to face its travel direction. Each leg's hip pivot is derived
      // from its group's origin (its matrix translation) — see render/doodles.ts
      // WALK_RIG (svg branch). Drawn front-on/rightward, so `faces: 'right'`.
      walk: { limbs: [[9], [10]], swing: 20, faces: 'right' },
    },
    snail: {
      label: 'Snail',
      art: [
        // Shell coil spiralling out from the centre and flowing up into the neck — one
        // continuous stroke, exactly as it was drawn.
        s([[42.3, 44.2], [34.4, 46.4], [30.8, 44.2], [30.8, 39.9], [34.2, 36], [39.5, 32.2],
          [45, 30.3], [50.4, 30.5], [54.3, 33.7], [58.2, 40.3], [59.6, 49.8], [55.5, 58.5],
          [43.9, 65.6], [32.6, 67.1], [24.1, 63.1], [18.1, 53.7], [16.2, 41.3], [18.6, 31.3],
          [22.5, 24.1], [30.2, 16.5], [41.8, 10.7], [53.1, 10], [58.6, 12.9], [64.9, 17.7],
          [68.3, 22.8], [70.5, 28.1], [72, 32.1], [73.2, 34.9], [73.8, 37.9]], 'l'),
        // Outer silhouette: head → rounded front → belly → foot, sweeping to the tail tip.
        s([[56.3, 62.3], [66.2, 56.4], [69.1, 51.5], [71.6, 46.7], [73.6, 41.7], [75.4, 35.1],
          [77.6, 29.2], [79, 24.3], [81.8, 20.8], [85.6, 18.3], [90.8, 17.5], [95, 20.1],
          [96.7, 23.4], [99, 29], [100, 39.3], [100, 46.4], [97.6, 55.7], [94.3, 63.1],
          [90.4, 68.9], [82.5, 76.6], [74.2, 80.8], [66.2, 82.6], [58.8, 84.1], [48.8, 84.3],
          [40.1, 84.5], [34.4, 84.5], [28.3, 84.5], [21.4, 84.5], [16.2, 85.3], [11.3, 86.7],
          [4.3, 90.1], [1.9, 89.3], [0, 86.2], [1.3, 79.3]], 'l'),
        // Sole's upper edge, running from the tail up along the back and closing into
        // the body silhouette's start (56.3,62.3) so the underbody is one loop, not two
        // free ends under the shell.
        s([[1.3, 79.3], [4, 76.8], [5.6, 75.7], [9.5, 73.7], [11.8, 72.7], [14.8, 71.8],
          [20.7, 70.4], [22.7, 69.9], [25.6, 69.3], [28.9, 68.5], [30.5, 68.3], [34.2, 66.9],
          [40.5, 65.4], [47, 64], [52, 63.1], [56.3, 62.3]], 'l'),
        // Mouth: a short line across the head front.
        s([[83.7, 39.5], [86.7, 41.2], [88.8, 42.6], [90.5, 43.1], [93, 43.4], [97.1, 43.4]], 'm'),
        s(seg(88.4, 31.4, 88.7, 31.4), 'l'), // eye (a round dot)
      ],
      // No legs to swing: an empty limb list keeps only the facing-flip (faces travel).
      walk: { limbs: [], swing: 0, faces: 'right' },
    },
    worker: {
      label: 'Worker',
      render: 'svg',
      svg: WORKER_SVG,
    },
  },
  spawn: (at) => ({
    kind: 'builder',
    position: clone(at),
    sprite: { shape: 'builder' },
    // Each snail gets its own pace (±15%) and wobble phase, so a crew fetching
    // the same brick doesn't read as one sprite cloned three times.
    build: {
      state: 'build',
      carrying: null,
      placed: 0,
      speed: MOVE.WALK * randFloat(0.85, 1.15),
      wander: randFloat(0, Math.PI * 2),
    },
  }),
  // Skin-neutral palette entry: the drop button adds a builder in whatever skin
  // is currently active (default 'hardhat'), not specifically a snail.
  palette: { label: 'Builder', icon: <Icon name="person" /> },
  thought: (e) => {
    if (!e.build) return ''
    const b = e.build
    // One bubble at a time: builderSystem hands the floor to a single builder at
    // a time (rotating on a timer), so the crew speaks in TURNS rather than all
    // theorizing at once. A builder that isn't the current speaker stays silent.
    if (!b.speaking) return ''
    // `wander` (per-builder phase) keeps each snail's line its own; the advancing
    // seed (`placed`, or the break's hangout spot) rotates the line over time
    // without flickering within a single state.
    const phase = Math.round((b.wander ?? 0) * 5)
    if (b.state === 'rest') {
      // Out of bricks → break-area seminar. Keyed on the fixed hangout spot (so
      // the line is stable while parked), nudged by `placed` so each new break
      // opens on a fresh thought. Only the current speaker's line is shown.
      return pickUnique('rest', REST_LINES, (b.rest?.x ?? 0) + b.placed)
    }
    if (b.state === 'idle') return ''
    // Mid-task the crew still can't stop theorizing; the line rotates as bricks
    // go down (`placed`), decorrelated between fetch/carry by different weights.
    return b.carrying
      ? pickUnique('stack', STACK_LINES, b.placed + phase)
      : pickUnique('fetch', FETCH_LINES, b.placed * 3 + phase)
  },
}

// ── brick (a NATIVE tldraw rectangle) ─────────────────────────────────────────
const brick: CharacterDef = {
  kind: 'brick',
  render: 'rect',
  rect: { w: 96, h: 44 }, // must match BRICK_W/BRICK_H in builderSystem
  size: 96, // nominal (unused for rect render; kept for KIND_SIZE completeness)
  color: 'red',
  // Pile bricks scatter a little around the drop point so a stack of rects reads
  // as a heap; a single dropped brick just lands with a touch of jitter.
  spawn: (at) => ({
    kind: 'brick',
    position: {
      x: at.x + (Math.random() - 0.5) * 120,
      y: at.y + (Math.random() - 0.5) * 80,
    },
    brick: { state: 'pile' },
  }),
  palette: { label: 'Brick', icon: <Icon name="brick" /> },
}

// ── truck (vehicle reskin: hauls brick piles from the factory) ────────────────
// Same hand-drawn body as Busytown's van; the delivery BEHAVIOR (load → haul →
// dump → return, sim/systems.ts → truckSystem) comes from the new `deliver`
// component, which only the Builder scene's pipeline reads. Spawns in 'return'
// so a player-dropped truck first drives home to the factory and loads properly.
const truck: CharacterDef = {
  kind: 'truck',
  size: 168,
  color: 'orange',
  art: VAN_ART,
  // No limbs to swing — the empty rig keeps just the facing-flip, so the truck
  // points the way it drives (out to the drop, back to the factory).
  walk: { limbs: [], swing: 0, faces: 'right' },
  spawn: (at) => ({
    kind: 'truck',
    position: clone(at),
    sprite: { shape: 'truck' },
    deliver: {
      state: 'return',
      speed: MOVE.WALK * MOVE.VAN_SPEED_MULT,
      until: 0,
      load: 0,
      drop: null,
    },
  }),
  palette: { label: 'Truck', icon: <Icon name="truck" /> },
  thought: (e) => {
    // The truck theorizes too — but ONLY while parked, so the bubble never slides
    // along the road: loading at the factory ('load') or tipping its pile at the
    // drop ('dump'). Silent while hauling out and returning. Keyed on the timer
    // (+ drop point) so each stop gets its own line, held stable the whole pause.
    const d = e.deliver
    if (!d) return ''
    const seed = (d.drop?.x ?? 0) + (d.drop?.y ?? 0) + d.until
    if (d.state === 'load') return pickUnique('load', LOAD_LINES, seed)
    if (d.state === 'dump') return pickUnique('dump', DUMP_LINES, seed)
    return ''
  },
}

// ── factory (prop: advertises the 'supply' affordance the truck loads at) ─────
// A sawtooth-roofed works with a smoking chimney. Placed FAR from the tower
// site so every delivery is a visible drive across the canvas.
const factory: CharacterDef = {
  kind: 'factory',
  size: 220,
  color: 'grey',
  art: [
    s(poly([[10, 84], [10, 46], [88, 46], [88, 84]]), 'm'), // walls
    s(poly([[10, 46], [10, 30], [36, 46], [36, 30], [62, 46], [62, 30], [88, 46]]), 'l'), // sawtooth roof
    s(poly([[76, 44], [76, 12], [84, 12], [84, 44]]), 'm'), // chimney
    s(ring(80, 7, 4, 3), 's', true), // smoke puff
    s(poly([[44, 84], [44, 66], [56, 66], [56, 84]]), 'm'), // door
    s(poly([[16, 54], [28, 54], [28, 64], [16, 64], [16, 54]]), 's', true), // windows
    s(poly([[60, 54], [72, 54], [72, 64], [60, 64], [60, 54]]), 's', true),
    s(seg(6, 84, 94, 84), 'm'), // ground line
  ],
  spawn: (at) => ({
    kind: 'factory',
    position: clone(at),
    sprite: { shape: 'factory' },
    affordance: { tags: ['supply'], capacity: 99, occupants: 0 },
  }),
  palette: { label: 'Factory', icon: <Icon name="factory" /> },
}

export const BUILDER_CHARACTERS: CharacterDef[] = [builder, brick, truck, factory]
