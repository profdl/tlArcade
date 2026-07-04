/**
 * Busytown characters — the seven original kinds as CharacterDefs.
 * -----------------------------------------------------------------
 * Art was DOODLES[kind]; size was KIND_SIZE[kind]; color was KIND_COLOR[kind];
 * spawn merges the buildWorld inline construction and the dropEntity preset into
 * one constructor; thought was thoughtFor's per-kind branch. The numbers are
 * carried over verbatim, so the Busytown scene stays behaviourally identical.
 *
 * Initial timers are STAGGERED here (as buildWorld did) so a freshly spawned
 * roster doesn't roll its first whim / hop on the same tick — a synchronized
 * start reads as an artificial opening surge. Player-dropped entities get the
 * same small random delay, which reads as natural.
 */
import { seg, poly, ring, capsule, s, type Stroke } from '../../render/freehand'
import { Icon } from '../../render/icons'
import { MOVE, STALL_MAX, TIMING } from '../../sim/config'
import type { Vec2 } from '../../sim/components'
import type { CharacterDef } from './types'

const clone = (at: Vec2): Vec2 => ({ x: at.x, y: at.y })
const stagger = (max: number) => Math.floor(Math.random() * max)

// ── townsperson ──────────────────────────────────────────────────────────────
const townsperson: CharacterDef = {
  kind: 'townsperson',
  size: 96,
  color: 'black',
  // STADIUM body (matches tldraw's native "oval" geo, which is a stadium — not
  // a true ellipse) with line eyes, mouth, arms, legs and feet, all at M weight.
  art: [
    s(capsule(48.5, 6, 74.5, 20.6), 'm', true), // oval (stadium) body
    s(seg(38.2, 31.6, 38.6, 39.1), 'm'), // left eye
    s(seg(48.2, 31.6, 48.6, 39.1), 'm'), // right eye
    s(poly([[36.5, 55.7], [44.5, 60.2], [47.2, 61.6], [49.5, 60.2], [56.2, 55.7]]), 'm'), // smile
    s(seg(31.6, 67.0, 25.9, 78.9), 'm'), // left arm
    s(seg(62.9, 62.0, 74.1, 73.9), 'm'), // right arm
    s(seg(42.5, 73.0, 42.9, 93.8), 'm'), // left leg
    s(seg(56.9, 73.0, 57.3, 93.8), 'm'), // right leg
    s(seg(42.5, 93.8, 37.2, 94.0), 'm'), // left foot
    s(seg(56.9, 93.8, 51.5, 94.0), 'm'), // right foot
  ],
  // Legs (+ their feet) swing as the person walks: left = leg 6 / foot 8,
  // right = leg 7 / foot 9. Each limb rotates about its hip (top of the leg).
  // The doodle's feet point left, so it faces left natively and mirrors to
  // face right when walking rightward.
  walk: { limbs: [[6, 8], [7, 9]], swing: 20, faces: 'left' },
  spawn: (at) => ({
    kind: 'townsperson',
    position: clone(at),
    // sprite.shape doubles as the render key; keep it === kind so the single
    // registry entry drives both behavior (e.kind) and art (e.sprite.shape).
    sprite: { shape: 'townsperson' },
    mover: { speed: MOVE.WALK, target: null, arrived: false },
    whim: { kind: 'wander', target: null },
    dweller: { state: 'idle', until: stagger(40), bench: null },
    interactor: { state: 'none', partner: null, until: 0, cooldownUntil: 0 },
  }),
  palette: { label: 'Person', icon: <Icon name="person" /> },
  thought: (e) => {
    if (!e.dweller) return ''
    if (e.interactor?.state === 'greet') return 'Oh, hello!'
    switch (e.dweller.state) {
      case 'sit':
        return "I'll feed the birds"
      case 'shop':
        return 'Just a few things…'
      case 'walk':
        switch (e.whim?.kind) {
          case 'shop':
            return 'I need groceries'
          case 'rest':
            return 'Time to sit down'
          case 'home':
            return 'Off home for dinner'
          default:
            return 'Out for a stroll'
        }
      default:
        return ''
    }
  },
}

// ── bird ─────────────────────────────────────────────────────────────────────
const bird: CharacterDef = {
  kind: 'bird',
  size: 72,
  color: 'black',
  art: [
    s(ring(46, 52, 17, 12), 'm', true), // body
    s(ring(64, 44, 7, 7), 'm', true), // head
    s(poly([[71, 44], [80, 46], [71, 49]]), 's'), // beak
    s(ring(65, 42, 1.3, 1.3), 's', true), // eye
    s(poly([[40, 50], [50, 57], [60, 51]]), 's'), // wing
    s(seg(30, 52, 18, 47), 'm'), // tail
    s(seg(30, 55, 18, 57), 'm'),
  ],
  spawn: (at) => ({
    kind: 'bird',
    position: clone(at),
    sprite: { shape: 'bird' },
    perch: { state: 'perch', until: stagger(TIMING.BIRD_PERCH[1]) },
  }),
  palette: { label: 'Bird', icon: <Icon name="bird" /> },
}

// ── bench (prop: sit) ─────────────────────────────────────────────────────────
const bench: CharacterDef = {
  kind: 'bench',
  size: 120,
  color: 'orange',
  art: [
    s(seg(16, 54, 84, 54), 'l'), // seat
    s(seg(16, 61, 84, 61), 'm'), // seat front
    s(seg(18, 33, 82, 33), 'm'), // top rail
    s(seg(26, 54, 26, 33), 's'),
    s(seg(50, 54, 50, 33), 's'),
    s(seg(74, 54, 74, 33), 's'),
    s(seg(22, 61, 22, 77), 'm'), // legs
    s(seg(78, 61, 78, 77), 'm'),
  ],
  spawn: (at) => ({
    kind: 'bench',
    position: clone(at),
    sprite: { shape: 'bench' },
    affordance: { tags: ['sit'], capacity: TIMING.BENCH_CAPACITY, occupants: 0 },
  }),
  palette: { label: 'Bench', icon: <Icon name="bench" /> },
}

// ── stall (prop: shop, carries stock) ─────────────────────────────────────────
const stall: CharacterDef = {
  kind: 'stall',
  size: 152,
  color: 'red',
  art: [
    s(poly([[20, 80], [20, 57], [80, 57], [80, 80]]), 'm'), // counter
    s(seg(16, 57, 84, 57), 'm'),
    s(seg(24, 57, 24, 42), 'm'), // posts
    s(seg(76, 57, 76, 42), 'm'),
    s(poly([[14, 42], [50, 27], [86, 42]]), 'm'), // awning peak
    s(seg(14, 42, 86, 42), 'm'),
    s(seg(32, 42, 40, 29), 's'), // stripes
    s(seg(50, 42, 50, 27), 's'),
    s(seg(68, 42, 60, 29), 's'),
  ],
  spawn: (at) => ({
    kind: 'stall',
    position: clone(at),
    sprite: { shape: 'stall' },
    affordance: { tags: ['shop'], capacity: 99, occupants: 0 },
    stock: { amount: STALL_MAX, max: STALL_MAX },
  }),
  palette: { label: 'Stall', icon: <Icon name="stall" /> },
}

// ── house (prop: home) ────────────────────────────────────────────────────────
const house: CharacterDef = {
  kind: 'house',
  size: 144,
  color: 'black',
  art: [
    s(poly([[26, 82], [26, 48], [74, 48], [74, 82]]), 'm'), // walls
    s(seg(24, 82, 76, 82), 'm'),
    s(poly([[20, 48], [50, 24], [80, 48]]), 'l'), // roof
    s(seg(20, 48, 80, 48), 'm'),
    s(poly([[44, 82], [44, 62], [56, 62], [56, 82]]), 'm'), // door
    s(poly([[58, 54], [68, 54], [68, 64], [58, 64], [58, 54]]), 's', true), // window
  ],
  spawn: (at) => ({
    kind: 'house',
    position: clone(at),
    sprite: { shape: 'house' },
    affordance: { tags: ['home'], capacity: 99, occupants: 0 },
    spawner: { kind: 'townsperson' },
  }),
  palette: { label: 'House', icon: <Icon name="house" /> },
}

// ── tree (prop: perch) ────────────────────────────────────────────────────────
const tree: CharacterDef = {
  kind: 'tree',
  size: 136,
  color: 'green',
  art: [
    s(seg(50, 85, 50, 55), 'l'), // trunk
    s(ring(40, 42, 16, 14), 'm', true), // canopy clusters
    s(ring(60, 42, 16, 14), 'm', true),
    s(ring(50, 31, 17, 15), 'm', true),
  ],
  spawn: (at) => ({
    kind: 'tree',
    position: clone(at),
    sprite: { shape: 'tree' },
    affordance: { tags: ['perch'], capacity: 99, occupants: 0 },
  }),
  palette: { label: 'Tree', icon: <Icon name="tree" /> },
}

// ── van (vehicle: drives the lane, restocks the stall) ────────────────────────
/** The van body, drawn facing RIGHT (cab and window at the right). Shared with
 *  the Builder scene's delivery truck (content/characters/builder.tsx) so the
 *  two vehicles keep the same hand-drawn silhouette. */
export const VAN_ART: Stroke[] = [
  s(poly([[14, 70], [14, 52], [42, 52], [50, 40], [80, 40], [86, 54], [86, 70], [14, 70]]), 'm', true), // body
  s(poly([[52, 51], [68, 51], [68, 42], [58, 42], [52, 51]]), 's', true), // window
  s(seg(50, 53, 50, 69), 's'), // door seam
  s(ring(32, 72, 7, 7), 'm', true), // wheels
  s(ring(68, 72, 7, 7), 'm', true),
]

const van: CharacterDef = {
  kind: 'van',
  size: 168,
  color: 'blue',
  art: VAN_ART,
  spawn: (at) => ({
    kind: 'van',
    position: clone(at),
    sprite: { shape: 'van' },
    mover: { speed: MOVE.WALK * MOVE.VAN_SPEED_MULT, target: null, arrived: false },
    vehicle: { state: 'drive', speed: MOVE.WALK * MOVE.VAN_SPEED_MULT, until: 0 },
  }),
  // Not in Busytown's palette (roster-only), but defined for completeness.
}

export const BUSYTOWN_CHARACTERS: CharacterDef[] = [
  townsperson,
  bird,
  bench,
  stall,
  house,
  tree,
  van,
]
