/**
 * Busytown — the original town as a SceneDef.
 * -------------------------------------------
 * Carries the EXACT numbers from the old config: CANVAS → bounds, LAYOUT →
 * props, START → roster, and the fixed runSystems order → pipeline. This is the
 * behavior-preservation anchor: loading this scene must be visually and
 * behaviourally identical to the pre-refactor app (7 townsfolk + 4 birds + 2
 * benches + 1 stall + 3 houses + 3 trees + 1 van, same staggered start, same
 * ~1.7 concurrent interactions).
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
} from '../../sim/systems'
import type { SceneDef } from './types'

/** Authored on the base 1000×700 grid, then scaled by SCALE (as the old LAYOUT). */
const at = (x: number, y: number) => ({ x: x * SCALE, y: y * SCALE })

export const busytown: SceneDef = {
  id: 'busytown',
  name: 'Busytown',
  bounds: { w: 1000 * SCALE, h: 700 * SCALE }, // was CANVAS
  props: [
    // Houses (home) — was LAYOUT.HOUSES.
    { kind: 'house', at: at(120, 90) },
    { kind: 'house', at: at(500, 70) },
    { kind: 'house', at: at(880, 90) },
    // Benches (sit) — was LAYOUT.BENCHES.
    { kind: 'bench', at: at(300, 470) },
    { kind: 'bench', at: at(720, 470) },
    // Stall (shop) — was LAYOUT.STALL.
    { kind: 'stall', at: at(500, 410) },
    // Trees (perch) — was LAYOUT.TREES.
    { kind: 'tree', at: at(180, 250) },
    { kind: 'tree', at: at(820, 250) },
    { kind: 'tree', at: at(500, 560) },
  ],
  roster: [
    // Townsfolk start cycling over the houses (was HOUSES[i % len]).
    { kind: 'townsperson', count: 7, placement: { atKind: 'house' } },
    // Birds start cycling over the trees (was TREES[i % len]).
    { kind: 'bird', count: 4, placement: { atKind: 'tree' } },
    // Van starts off-canvas on the path lane, PATH_Y = 350 (was the inline add).
    { kind: 'van', count: 1, placement: { points: [{ x: -50 * SCALE, y: 350 * SCALE }] } },
  ],
  pipeline: [whimSystem, moveSystem, arriveSystem, dwellSystem, greetSystem, birdSystem, vanSystem],
  palette: ['townsperson', 'bird', 'bench', 'stall', 'house', 'tree', 'fairy', 'villager'],
}
