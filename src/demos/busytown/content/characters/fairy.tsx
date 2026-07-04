/**
 * Fairy + villager — a rounder, softer doodle style (round head, dot eyes,
 * small curved smile) than Busytown's original stadium-body townsperson.
 * `fairy` carries the wings + a curling spark/flame crown; `villager` is the
 * same figure with the wings and crown dropped, hands at its sides — the
 * "regular person" cut of the same design.
 *
 * Both register via CHARACTERS and are in Busytown's `palette`, so the player
 * can drop them in; neither is in any scene's opening `roster` yet.
 */
import { capsule, poly, ring, seg, s } from '../../render/freehand'
import { Icon } from '../../render/icons'
import { MOVE } from '../../sim/config'
import type { CharacterDef } from './types'
import type { Vec2 } from '../../sim/components'

const clone = (at: Vec2): Vec2 => ({ x: at.x, y: at.y })
const stagger = (max: number) => Math.floor(Math.random() * max)

// ── fairy ────────────────────────────────────────────────────────────────────
const fairy: CharacterDef = {
  kind: 'fairy',
  size: 96,
  color: 'black',
  art: [
    s(capsule(50, 40, 68, 11), 'm', true, true), // stadium torso (matches the original townsperson body shape), solid white
    s(ring(50, 31, 15, 14), 'm', true, true), // round head, sunk down to overlap the torso's top, solid white, drawn on top of the torso
    s(ring(44, 30, 1.3, 1.5), 's', true), // left eye
    s(ring(56, 30, 1.3, 1.5), 's', true), // right eye
    s(poly([[43, 37], [48, 40.5], [50, 41.5], [52, 40.5], [57, 37]]), 's'), // smile
    s(poly([[45, 22], [40, 15], [41, 8], [47, 5], [53, 9], [52, 16], [46, 22]]), 'm', true), // single curling flame/spark, tilted left of centre
    // Rounded petal wings, tip tucked toward the torso, wide rounded outer curve.
    s(poly([[40, 46], [32, 34], [22, 30], [12, 34], [8, 44], [12, 54], [22, 58], [34, 54], [40, 46]]), 'm', true), // left wing
    s(poly([[60, 46], [68, 34], [78, 30], [88, 34], [92, 44], [88, 54], [78, 58], [66, 54], [60, 46]]), 'm', true), // right wing
    s(seg(41, 50, 50, 60), 'm'), // left arm, folded to centre
    s(seg(59, 50, 50, 60), 'm'), // right arm, folded to centre
    s(seg(46, 68, 44, 90), 'm'), // left leg
    s(seg(54, 68, 56, 90), 'm'), // right leg
  ],
  spawn: (at) => ({
    kind: 'fairy',
    position: clone(at),
    sprite: { shape: 'fairy' },
    mover: { speed: MOVE.WALK, target: null, arrived: false },
    whim: { kind: 'wander', target: null },
    dweller: { state: 'idle', until: stagger(40), bench: null },
    interactor: { state: 'none', partner: null, until: 0, cooldownUntil: 0 },
  }),
  palette: { label: 'Fairy', icon: <Icon name="person" /> },
  thought: () => '',
}

// ── villager (the fairy's art, minus wings + crown — a "regular person") ─────
const villager: CharacterDef = {
  kind: 'villager',
  size: 96,
  color: 'black',
  art: [
    s(capsule(50, 40, 72, 12), 'm', true, true), // stadium torso (matches the original townsperson body shape), solid white
    s(ring(50, 31, 15, 14), 'm', true, true), // round head, sunk down to overlap the torso's top, solid white, drawn on top of the torso
    s(ring(44, 30, 1.3, 1.5), 's', true), // left eye
    s(ring(56, 30, 1.3, 1.5), 's', true), // right eye
    s(poly([[43, 37], [48, 40.5], [50, 41.5], [52, 40.5], [57, 37]]), 's'), // smile
    s(seg(38, 48, 30, 62), 'm'), // left arm
    s(seg(62, 48, 70, 62), 'm'), // right arm
    s(seg(46, 72, 44, 92), 'm'), // left leg
    s(seg(54, 72, 56, 92), 'm'), // right leg
  ],
  // Same leg indices as townsperson's walk rig, minus its feet (removed here).
  walk: { limbs: [[7], [8]], swing: 20, faces: 'left' },
  spawn: (at) => ({
    kind: 'villager',
    position: clone(at),
    sprite: { shape: 'villager' },
    mover: { speed: MOVE.WALK, target: null, arrived: false },
    whim: { kind: 'wander', target: null },
    dweller: { state: 'idle', until: stagger(40), bench: null },
    interactor: { state: 'none', partner: null, until: 0, cooldownUntil: 0 },
  }),
  palette: { label: 'Villager', icon: <Icon name="person" /> },
  thought: () => '',
}

export const FAIRY_CHARACTERS: CharacterDef[] = [fairy, villager]
