/**
 * Builder — a one-crew level with a supply chain.
 * -----------------------------------------------
 * The canvas starts with NO bricks: three snail builders wait in their break
 * area beside the tower site, talking snail sports. A delivery truck loads
 * brick piles at the factory in the far corner and dumps them at random spots
 * around the canvas; the moment a pile lands, the snails fetch and stack it
 * into ONE shared tower (courses left→right, bottom→top, forever). Deliveries
 * are timed just-in-time (truckSystem's LOW_WATER trigger): the crew is always
 * nearly out of bricks but rarely gets a break. The bricks are NATIVE tldraw
 * rectangles, so the finished tower is real, editable shapes.
 *
 * Pipeline is builderSystem + truckSystem — no townsfolk, birds, or van. The
 * palette lets you toss extra bricks, another truck, or a second factory in.
 */
import { SCALE } from '../../sim/config'
import { builderSystem, truckSystem, gardenerSystem } from '../../sim/systems'
import type { SceneDef } from './types'

const at = (x: number, y: number) => ({ x: x * SCALE, y: y * SCALE })

export const builder: SceneDef = {
  id: 'builder',
  name: 'Builder',
  bounds: { w: 900 * SCALE, h: 640 * SCALE },
  props: [
    // The brick factory, tucked into the far top-right corner — a long haul
    // from the tower site (~42% w, 70% h), so every delivery is a visible
    // drive across the canvas.
    { kind: 'factory', at: at(800, 95) },
  ],
  roster: [
    // Three snails, spawned IN the break area (left of the tower site — the same
    // huddle builderSystem sends an out-of-bricks crew to), so with no bricks
    // on the canvas they open the scene chatting about snail sports.
    {
      kind: 'builder',
      count: 3,
      placement: {
        points: [at(238, 432), at(268, 452), at(292, 430)],
      },
    },
    // The delivery truck starts just off the factory and pulls in to load.
    { kind: 'truck', count: 1, placement: { points: [at(800, 140)] } },
    // One gardener works the yard, laying out a plot of vegetable & flower rows
    // (gardenerSystem) — a tidy garden alongside the construction.
    { kind: 'gardener', count: 1, placement: { points: [at(150, 480)] } },
  ],
  pipeline: [builderSystem, truckSystem, gardenerSystem],
  palette: [
    'builder', 'brick', 'truck', 'factory', 'gardener',
    'carrot', 'tomato', 'cabbage', 'flower', 'sapling', 'vine',
  ],
}
