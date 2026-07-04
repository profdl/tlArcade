/**
 * Pondside — the proof-of-flexibility scene.
 * ------------------------------------------
 * Smaller than Busytown, and it exercises BOTH extension axes:
 *   • a NEW prop type + affordance the engine has never seen — the `pond`
 *     advertises 'drink' (open AffordanceTag), added with zero engine edits;
 *   • a NEW behavior — the `dog`, whose dogSystem is appended to this scene's
 *     pipeline. Every original system still runs, so townsfolk shop and rest,
 *     birds flock, and the van restocks exactly as in Busytown; the dog trots
 *     after the nearest person and detours to the pond for a drink.
 */
import { SCALE } from '../../sim/config'
import {
  whimSystem,
  moveSystem,
  arriveSystem,
  dwellSystem,
  greetSystem,
  birdSystem,
  vanSystem,
  dogSystem,
} from '../../sim/systems'
import type { SceneDef } from './types'

const at = (x: number, y: number) => ({ x: x * SCALE, y: y * SCALE })

export const pondside: SceneDef = {
  id: 'pondside',
  name: 'Pondside',
  bounds: { w: 820 * SCALE, h: 580 * SCALE },
  props: [
    { kind: 'house', at: at(120, 80) },
    { kind: 'house', at: at(680, 80) },
    { kind: 'bench', at: at(230, 400) },
    { kind: 'bench', at: at(560, 400) },
    { kind: 'stall', at: at(410, 330) },
    { kind: 'tree', at: at(150, 220) },
    { kind: 'tree', at: at(670, 220) },
    // The new prop: a pond advertising the new 'drink' affordance.
    { kind: 'pond', at: at(410, 470) },
  ],
  roster: [
    { kind: 'townsperson', count: 4, placement: { atKind: 'house' } },
    { kind: 'bird', count: 2, placement: { atKind: 'tree' } },
    { kind: 'van', count: 1, placement: { points: [{ x: -50 * SCALE, y: 290 * SCALE }] } },
    // The new-behavior character.
    { kind: 'dog', count: 1, placement: { points: [at(410, 250)] } },
  ],
  // Busytown's seven systems + the opt-in dogSystem.
  pipeline: [
    whimSystem,
    moveSystem,
    arriveSystem,
    dwellSystem,
    greetSystem,
    birdSystem,
    vanSystem,
    dogSystem,
  ],
  palette: ['townsperson', 'dog', 'bird', 'bench', 'stall', 'tree', 'house', 'pond'],
}
