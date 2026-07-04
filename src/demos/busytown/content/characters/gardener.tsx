/**
 * Gardener + the things it grows (Builder scene).
 * ------------------------------------------------
 * A fourth extension proof, all on the existing axes — no engine edits:
 *   • gardener — the SAME imported hard-hat worker as the builder, recoloured
 *     orange→green (a hi-vis vest becomes a garden-green one). It's a distinct
 *     KIND with its own behavior (sim/systems.ts → gardenerSystem): it lays out a
 *     tidy plot — rows of vegetables and flowers — rather than stacking bricks.
 *   • flower / carrot / tomato / cabbage / sapling / vine — PLANTS that grow.
 *     Each carries the `plant` component; gardenerSystem advances their size in
 *     place, and the render bridge draws them at that growing size (like a
 *     brick's size override). A vine is planted at the tower's foot and its
 *     ceiling chases the tower top, so it climbs the brick wall as the courses
 *     rise. (Vines & saplings are palette-drop extras; the automatic plot is
 *     vegetables + flowers, one variety per row.)
 *   • plantsign — a little staked signboard the gardener plants at the start of
 *     each row, naming the crop in it. Its label is drawn crisp in
 *     SpriteShapeUtil (like the stall's STORE sign), fed from the `sign`
 *     component the gardener stamps.
 *
 * The gardener reuses the builder's walk rig (same imported figure, so the same
 * two leg groups swing and the whole body flips to face travel).
 */
import { poly, seg, ring, s, type Stroke } from '../../render/freehand'
import { Icon } from '../../render/icons'
import { MOVE } from '../../sim/config'
import { randFloat } from '../../sim/rng'
import type { PlantVariety, Vec2 } from '../../sim/components'
import type { CharacterDef, SvgArtPart } from './types'
import { HARDHAT_SVG } from './builder'
import { pickUnique } from './speech'

const clone = (at: Vec2): Vec2 => ({ x: at.x, y: at.y })
const stagger = (max: number) => Math.floor(Math.random() * max)

// ── gardener (the hard-hat worker, orange→green) ────────────────────────────
/** Recolour an imported skin's parts, swapping one literal fill/stroke for
 *  another. Used to turn the builder's hi-vis ORANGE vest + hat into the
 *  gardener's GREEN ones while leaving the yellow reflective stripes untouched —
 *  "just change the orange to green". */
function recolor(parts: SvgArtPart[], from: string, to: string): SvgArtPart[] {
  return parts.map((p) => ({
    ...p,
    paths: p.paths.map((pt) => ({
      ...pt,
      fill: pt.fill === from ? to : pt.fill,
      stroke: pt.stroke === from ? to : pt.stroke,
    })),
  }))
}

const HARDHAT_ORANGE = '#e16919'
const GARDEN_GREEN = '#2f9e44'
const GARDENER_SVG: SvgArtPart[] = recolor(HARDHAT_SVG, HARDHAT_ORANGE, GARDEN_GREEN)

// Gardening aphorisms — the same portentous register as the crew's barbs, but
// turned toward growth and patience instead of bricks and lack.
const GARDEN_LINES = [
  'One does not build a garden; one waits for it.',
  'The seed already contains the whole tower.',
  'To plant is to argue with the future.',
  'Green is the only honest revolution.',
  'The vine will outlast the wall, comrade.',
  'I bury a thing so that it may rise.',
  'Patience is a form of labour, too.',
  'Every flower is a small, deliberate defiance.',
  'The soil asks for nothing and returns everything.',
  'Growth is the slowest kind of insistence.',
  'A sapling is a promise the earth intends to keep.',
  'Let it climb; the bricks were always its trellis.',
]

const gardener: CharacterDef = {
  kind: 'gardener',
  size: 100,
  color: 'green',
  defaultSkin: 'gardener',
  skins: {
    gardener: {
      label: 'Gardener',
      render: 'svg',
      svg: GARDENER_SVG,
      // Same rig as the hard-hat builder: legs are svg parts 9 (right) & 10
      // (left); the figure mirrors to face its travel direction.
      walk: { limbs: [[9], [10]], swing: 20, faces: 'right' },
    },
  },
  spawn: (at) => ({
    kind: 'gardener',
    position: clone(at),
    sprite: { shape: 'gardener' },
    garden: {
      state: 'idle',
      target: null,
      variety: null,
      speed: MOVE.WALK * randFloat(0.85, 1.15),
      until: stagger(30),
      wander: randFloat(0, Math.PI * 2),
    },
  }),
  palette: { label: 'Gardener', icon: <Icon name="leaf" /> },
  thought: (e) => {
    const g = e.garden
    if (!g || !g.speaking) return ''
    // Rotate the line as the gardener moves between plantings (keyed on the
    // rounded target x), held stable while walking to any one spot.
    return pickUnique('garden', GARDEN_LINES, Math.round((g.target?.x ?? 0) / 40) + Math.round((g.wander ?? 0) * 5))
  },
}

// ── plants (grow in place; sizes advanced by gardenerSystem) ────────────────
/** Build a `plant` component + its spawned entity. `at` is the ground point the
 *  gardener sowed at; it becomes the plant's FIXED bottom-centre anchor (base),
 *  and the sprite starts as a seedling (grow 0 → min size) centred just above it. */
function plantSpawn(
  variety: PlantVariety,
  size: { minW: number; maxW: number; minH: number; maxH: number },
  rate: number,
) {
  return (at: Vec2): ReturnType<CharacterDef['spawn']> => ({
    kind: variety,
    position: { x: at.x, y: at.y - size.minH / 2 },
    sprite: { shape: variety },
    plant: {
      variety,
      grow: 0,
      rate,
      base: clone(at),
      minW: size.minW,
      maxW: size.maxW,
      minH: size.minH,
      maxH: size.maxH,
      w: size.minW,
      h: size.minH,
    },
  })
}

// ── flower (a daisy: white petals, coloured outline, on a slender stem) ──────
const flower: CharacterDef = {
  kind: 'flower',
  size: 92,
  color: 'violet',
  // Bottom of the art sits at y≈98 so the stem meets the ground the plant is
  // anchored to. Paint order: stem, leaf, petals (white-backed, so they cover
  // the stem behind them), centre on top.
  art: [
    s(seg(50, 98, 50, 52), 'm'), // stem
    s(poly([[50, 74], [40, 70], [43, 79], [50, 76]]), 's', true, true), // leaf
    s(ring(50, 27, 6, 7.5), 'm', true, true), // petal — top
    s(ring(62.4, 36, 6, 7.5), 'm', true, true), // petal — upper right
    s(ring(57.6, 50.5, 6, 7.5), 'm', true, true), // petal — lower right
    s(ring(42.4, 50.5, 6, 7.5), 'm', true, true), // petal — lower left
    s(ring(37.6, 36, 6, 7.5), 'm', true, true), // petal — upper left
    s(ring(50, 40, 5, 5), 'm', true), // centre disc
  ],
  spawn: plantSpawn('flower', { minW: 10, maxW: 64, minH: 12, maxH: 90 }, 1 / 120),
  palette: { label: 'Flower', icon: <Icon name="flower" /> },
}

// ── carrot (orange root tapering down, feathery greens up) ───────────────────
const carrot: CharacterDef = {
  kind: 'carrot',
  size: 92,
  color: 'orange',
  // Root runs to y≈96 (the ground); greens fan up from the crown at y≈54.
  art: [
    s(poly([[42, 54], [58, 54], [50, 96], [42, 54]]), 'm', true, true), // tapered root
    s(seg(45, 66, 55, 66), 's'), // ridge line
    s(seg(46, 77, 54, 77), 's'), // ridge line
    s(seg(50, 54, 39, 26), 'm'), // frond — left
    s(seg(50, 54, 50, 20), 'm'), // frond — centre
    s(seg(50, 54, 61, 26), 'm'), // frond — right
  ],
  spawn: plantSpawn('carrot', { minW: 12, maxW: 58, minH: 14, maxH: 94 }, 1 / 150),
  palette: { label: 'Carrot', icon: <Icon name="carrot" /> },
}

// ── tomato (a staked plant hung with round fruit) ────────────────────────────
const tomato: CharacterDef = {
  kind: 'tomato',
  size: 110,
  color: 'red',
  // Main stem drops to the ground (y≈98); two fruits and a leafy crown.
  art: [
    s(seg(50, 98, 50, 44), 'm'), // stem
    s(ring(40, 71, 10, 10), 'm', true, true), // fruit — lower left
    s(ring(61, 59, 10, 10), 'm', true, true), // fruit — upper right
    s(poly([[50, 44], [40, 36], [50, 40]]), 's', true, true), // crown leaf — left
    s(poly([[50, 44], [60, 36], [50, 40]]), 's', true, true), // crown leaf — right
    s(seg(50, 42, 50, 30), 's'), // sprout tip
  ],
  spawn: plantSpawn('tomato', { minW: 14, maxW: 76, minH: 16, maxH: 112 }, 1 / 180),
  palette: { label: 'Tomato', icon: <Icon name="tomato" /> },
}

// ── cabbage (a round head of leaves, low to the ground) ──────────────────────
const cabbage: CharacterDef = {
  kind: 'cabbage',
  size: 96,
  color: 'green',
  // A leafy ball whose bottom (y≈94) rests near the soil, with curling veins.
  art: [
    s(ring(50, 76, 23, 18), 'm', true, true), // outer head
    s(ring(50, 76, 14, 11), 'm', true), // inner leaves
    s(seg(50, 58, 50, 94), 's'), // centre vein
    s(seg(37, 67, 45, 88), 's'), // vein — left
    s(seg(63, 67, 55, 88), 's'), // vein — right
  ],
  spawn: plantSpawn('cabbage', { minW: 16, maxW: 86, minH: 14, maxH: 82 }, 1 / 160),
  palette: { label: 'Cabbage', icon: <Icon name="cabbage" /> },
}

// ── sapling (a small tree that grows tall — reuses the tree silhouette) ──────
const sapling: CharacterDef = {
  kind: 'sapling',
  size: 150,
  color: 'green',
  // Trunk runs to y≈98 (the ground) so it doesn't float as it scales up.
  art: [
    s(seg(50, 98, 50, 52), 'l'), // trunk
    s(ring(40, 44, 16, 14), 'm', true), // canopy clusters
    s(ring(60, 44, 16, 14), 'm', true),
    s(ring(50, 32, 17, 15), 'm', true),
  ],
  spawn: plantSpawn('sapling', { minW: 16, maxW: 120, minH: 18, maxH: 150 }, 1 / 320),
  palette: { label: 'Tree', icon: <Icon name="tree" /> },
}

// ── vine (a wavy climber; its height chases the tower top in gardenerSystem) ─
/** The vine art: one serpentine stem from the ground (y=100) to the top of the
 *  box (y=0), with a few leaves sprouting off alternating sides. Rendered tall
 *  and narrow, it reads as a climber; gardenerSystem re-stretches its height to
 *  the tower's top each tick so it creeps up the bricks. */
function vineArt(): Stroke[] {
  const stem: number[][] = []
  const WAVES = 5
  const AMP = 16
  for (let i = 0; i <= 28; i++) {
    const t = i / 28
    stem.push([50 + Math.sin(t * Math.PI * WAVES) * AMP, 100 - t * 100])
  }
  const strokes: Stroke[] = [s(stem, 'm')]
  for (let k = 1; k <= 5; k++) {
    const t = k / 6
    const x = 50 + Math.sin(t * Math.PI * WAVES) * AMP
    const y = 100 - t * 100
    const side = k % 2 === 0 ? 1 : -1
    strokes.push(s(poly([[x, y], [x + side * 14, y - 7], [x + side * 7, y + 4], [x, y]]), 's', true, true))
  }
  return strokes
}

const vine: CharacterDef = {
  kind: 'vine',
  size: 220,
  color: 'light-green',
  art: vineArt(),
  // minH is just a seedling; maxH is a placeholder — gardenerSystem overrides it
  // every tick to reach the current tower top (see growPlant).
  spawn: plantSpawn('vine', { minW: 24, maxW: 46, minH: 20, maxH: 220 }, 1 / 360),
  palette: { label: 'Vine', icon: <Icon name="vine" /> },
}

// ── plantsign (a staked row label — one per plot row) ────────────────────────
/** The signboard the gardener plants at the head of each garden row. Only the
 *  STAKE is a doodle stroke here; the board + crop name are drawn crisp in
 *  SpriteShapeUtil (like the stall's STORE sign) from the entity's `sign.label`.
 *  Square box (size == render size) so the lettering never distorts. Not in any
 *  palette — signs are staked by the gardener, not free-dropped. */
const SIGN_SIZE = 78
const plantsign: CharacterDef = {
  kind: 'plantsign',
  size: SIGN_SIZE,
  color: 'orange', // the wooden stake; board + text are fixed colours in the util
  art: [s(seg(50, 100, 50, 48), 'm')], // stake, foot on the ground (y=100)
  spawn: (at: Vec2) => ({
    kind: 'plantsign',
    // Centre the box so its foot (y=100) rests on the ground point sown at.
    position: { x: at.x, y: at.y - SIGN_SIZE / 2 },
    sprite: { shape: 'plantsign' },
    sign: { label: '' }, // gardenerSystem stamps the crop name on placement
  }),
}

export const GARDENER_CHARACTERS: CharacterDef[] = [
  gardener,
  flower,
  carrot,
  tomato,
  cabbage,
  sapling,
  vine,
  plantsign,
]
