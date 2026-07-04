/**
 * Busytown — custom tldraw shape for every sim sprite.
 * One ShapeUtil for all kinds; `props.kind` selects the glyph. The sim owns
 * these shapes (it writes their position each tick via render/bridge.ts), so
 * they're non-resizable and created locked — the player drops *new* entities
 * rather than dragging existing ones.
 *
 * tldraw v5 registers custom shapes by augmenting TLGlobalShapePropsMap, which
 * folds `'sprite'` into the TLShape union so the editor's typed APIs
 * (createShapes / updateShapes / TLShapePartial) accept it.
 */
import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import {
  BaseBoxShapeUtil,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultSizeStyle,
  HTMLContainer,
  T,
  useEditor,
  type RecordProps,
  type TLBaseShape,
  type TLDefaultColorStyle,
  type TLDefaultDashStyle,
  type TLDefaultFillStyle,
  type TLDefaultSizeStyle,
  type TLShapeId,
} from 'tldraw'
import { DOODLE_RENDER, SVG_RENDER, SVG_RENDER_CARRY, WALK_RIG, DEFAULT_SKIN, type WalkRig } from './doodles'

/** Sprite props. `thought` is the bubble line (set by the render bridge);
 *  color/size/dash/fill are real tldraw STYLE props, so selecting a sprite
 *  shows the full style panel and editing it recolours/restyles the drawing.
 *  `skin` selects among a kind's alternate appearances (empty ⇒ the kind's
 *  default skin — see content/characters/types.ts → Skin, render/doodles.ts).
 *  `carrying` is set by the render bridge while the entity is hauling something
 *  (a builder with a brick); a skin with a `svgCarry` pose swaps to it.
 *  `loaded` is set while a vehicle is carrying cargo (the truck hauling bricks
 *  out to a drop) — it draws a little pile of bricks in the bed.
 *  `label` is the crop name a garden signpost carries (set by the render bridge
 *  from the `sign` component); it's drawn crisp on the signboard, like the
 *  stall's STORE sign. Empty for every other kind. */
export type SpriteProps = {
  w: number
  h: number
  kind: string
  skin: string
  thought: string
  carrying: boolean
  loaded: boolean
  label: string
  color: TLDefaultColorStyle
  size: TLDefaultSizeStyle
  dash: TLDefaultDashStyle
  fill: TLDefaultFillStyle
}
export type SpriteShape = TLBaseShape<'sprite', SpriteProps>

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    sprite: SpriteProps
  }
}

/** tldraw light-theme solid colours (the app runs light). */
const COLOR_HEX: Record<string, string> = {
  black: '#1d1d1d',
  grey: '#9fa8b2',
  'light-violet': '#e085f4',
  violet: '#ae3ec9',
  blue: '#4465e9',
  'light-blue': '#4ba1f1',
  yellow: '#f1ac4b',
  orange: '#e16919',
  green: '#099268',
  'light-green': '#4cb05e',
  'light-red': '#f87777',
  red: '#e03131',
  white: '#ffffff',
}

const inkHex = (color: string) => COLOR_HEX[color] ?? '#1d1d1d'

/** Translucent tint for the `semi`/`pattern` fill styles. */
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function dashArray(dash: TLDefaultDashStyle, sw: number): string | undefined {
  if (dash === 'dashed') return `${sw * 2.5} ${sw * 1.6}`
  if (dash === 'dotted') return `${sw * 0.01} ${sw * 1.8}`
  return undefined // solid / none → continuous
}

/** A small "STORE" shop sign, hung under the stall's awning (drawn crisp so it
 *  stays readable, unlike the hand-inked doodle strokes). */
function StoreSign() {
  return (
    <g>
      <rect x="28" y="44" width="44" height="13" rx="3" fill="#fcfcf8" stroke="#352f2b" strokeWidth="1.3" />
      <text
        x="50"
        y="53.6"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="700"
        letterSpacing="0.6"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill="#352f2b"
      >
        STORE
      </text>
    </g>
  )
}

/** A garden-row signboard: the crop name on a little wooden placard atop the
 *  stake (the stake itself is the plantsign's doodle stroke). Drawn crisp so the
 *  lettering stays readable, like the STORE sign. `textLength` force-fits the
 *  word to the board width so long names (TOMATOES) never spill over. */
function PlantSign({ label }: { label: string }) {
  return (
    <g>
      <rect x="6" y="18" width="88" height="30" rx="4" fill="#fcfcf8" stroke="#7a5636" strokeWidth="1.8" />
      {label ? (
        <text
          x="50"
          y="38.5"
          textAnchor="middle"
          fontSize="13"
          fontWeight="700"
          letterSpacing="0.4"
          textLength="78"
          lengthAdjust="spacingAndGlyphs"
          fontFamily="system-ui, -apple-system, sans-serif"
          fill="#4a3524"
        >
          {label}
        </text>
      ) : null}
    </g>
  )
}

/** Fraction of the sprite box (measured from the top) that is EMPTY above the
 *  drawn figure, per kind. The thought bubble anchors to the top of the box, so
 *  a kind drawn low in its box (the truck/van, whose cab roof sits ~40% down)
 *  would float its bubble far above the art. Dropping the bubble by this much
 *  seats it just above the figure. Omitted kinds fill their box from the top. */
const ART_TOP_FRAC: Record<string, number> = { truck: 0.4, van: 0.4 }

/** A little pyramid pile of tiny bricks that rides in the truck's bed while it
 *  hauls a load out to a drop (props.loaded). Coordinates are [x, y, w, h] in
 *  the shared 0–100 art box, seated in the flatbed behind the cab (the van art's
 *  low left section, top rim ~y=52). Rendered INSIDE the sprite's flip group so
 *  the heap stays in the bed whichever way the truck faces. */
const TRUCK_BED_BRICKS: [number, number, number, number][] = [
  [16, 48.5, 7, 3.4], [24.3, 48.5, 7, 3.4], [32.6, 48.5, 7, 3.4], // bottom course
  [20.1, 44.6, 7, 3.4], [28.4, 44.6, 7, 3.4], // middle course
  [24.3, 40.7, 7, 3.4], // cap
]

/** A tiny thought bubble floating above a townsperson. Sized relative to the
 *  sprite width `w` (tuned at w=48) so it scales with the figure and on resize —
 *  but CAPPED at a person-sized reference so a big vehicle (the truck, size 168)
 *  gets the same readable bubble as a worker (size 100), not one 1.7× larger.
 *  `drop` (px) lowers the bubble to sit above the ART rather than the box top. */
const BUBBLE_REF_W = 100 // a worker's width — the bubble never scales past this
function ThoughtBubble({ text, w, drop = 0 }: { text: string; w: number; drop?: number }) {
  const k = Math.min(w, BUBBLE_REF_W) / 48
  const puff = (d: number, mt: number) => (
    <div
      style={{
        width: d * k,
        height: d * k,
        borderRadius: d * k,
        background: '#fff',
        border: `${k}px solid rgba(0,0,0,0.16)`,
        marginTop: mt * k,
      }}
    />
  )
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        // A 7·k gap above the box top, then lowered by `drop` to seat the bubble
        // just above the figure for kinds drawn low in their box (vehicles).
        marginBottom: 7 * k - drop,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          background: '#fff',
          border: `${k}px solid rgba(0,0,0,0.16)`,
          borderRadius: 9 * k,
          padding: `${2 * k}px ${7 * k}px`,
          fontSize: 9 * k,
          lineHeight: 1.25,
          color: '#352f2b',
          whiteSpace: 'nowrap',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          boxShadow: `0 ${k}px ${2 * k}px rgba(0,0,0,0.12)`,
        }}
      >
        {text}
      </div>
      {/* trailing puffs make it a *thought* bubble, not a speech bubble */}
      {puff(4, 1.5)}
      {puff(2.5, 1)}
    </div>
  )
}

/** A sprite whose legs walk and whose body faces its travel direction. It runs
 *  one requestAnimationFrame loop (~60 fps) reading the shape's page position —
 *  so both the swing and the facing stay smooth even though the sim only syncs
 *  positions ~10×/sec — and drives two things imperatively (setAttribute), so
 *  React's ~10 Hz re-renders never fight the animation:
 *   • the leg `<g>` groups swing in alternating phase, each rotating about its
 *     hip; the amplitude eases in/out so the legs settle when the walk stops.
 *   • the outer `<g>` mirrors horizontally so the art faces the way it's moving
 *     (relative to the direction it's natively drawn facing, `rig.faces`). */
function AnimatedSprite({
  shapeId,
  rig,
  bodyStrokes,
  limbStrokes,
}: {
  shapeId: TLShapeId
  rig: WalkRig
  bodyStrokes: ReactNode
  limbStrokes: ReactNode[]
}) {
  const editor = useEditor()
  const flipRef = useRef<SVGGElement | null>(null)
  const refs = useRef<(SVGGElement | null)[]>([])
  useEffect(() => {
    let raf = 0
    let last = 0
    let phase = 0
    let amp = 0
    let lastPos = editor.getShapePageBounds(shapeId)?.center ?? null
    let lastMoveMs = -Infinity
    const nativeDir = rig.faces === 'right' ? 1 : -1 // sign the art is drawn facing
    let facing = nativeDir // current facing; keep last heading when stopped
    // The sim only moves shapes ~10×/sec (per tick), so between animation frames
    // the position is usually unchanged — a frame-to-frame speed would read zero
    // most frames. Instead we timestamp the last real displacement and treat the
    // character as walking until it's been still for STILL_MS (> one tick).
    const MOVE_EPS = 0.5 // page px between samples that counts as movement
    const FACE_EPS = 0.3 // min horizontal displacement to change facing
    const STILL_MS = 250 // no movement this long ⇒ stop walking
    const CADENCE = 10 // stride angular speed (rad/sec)
    const frame = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60
      last = now
      const c = editor.getShapePageBounds(shapeId)?.center ?? null
      if (c && lastPos) {
        const dx = c.x - lastPos.x
        if (Math.hypot(dx, c.y - lastPos.y) > MOVE_EPS) {
          lastMoveMs = now
          if (Math.abs(dx) > FACE_EPS) {
            const dir = dx < 0 ? -1 : 1
            if (dir !== facing) {
              facing = dir
              const g = flipRef.current
              // Mirror about x=50 (the 0–100 art box) when heading opposite the
              // art's native facing; otherwise render un-mirrored.
              if (g) {
                if (facing === nativeDir) g.removeAttribute('transform')
                else g.setAttribute('transform', 'translate(100 0) scale(-1 1)')
              }
            }
          }
          lastPos = c
        }
      } else if (c) {
        lastPos = c
      }
      const moving = now - lastMoveMs < STILL_MS
      amp += ((moving ? 1 : 0) - amp) * Math.min(1, dt * 8)
      if (moving || amp > 0.001) phase += dt * CADENCE
      for (let li = 0; li < rig.limbs.length; li++) {
        const g = refs.current[li]
        if (!g) continue
        const { x, y } = rig.limbs[li].pivot
        const deg = Math.sin(phase + li * Math.PI) * rig.swing * amp
        g.setAttribute('transform', `rotate(${deg.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})`)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [editor, shapeId, rig])
  return (
    <g ref={flipRef}>
      {bodyStrokes}
      {limbStrokes.map((strokes, li) => (
        <g
          key={li}
          ref={(el) => {
            refs.current[li] = el
          }}
        >
          {strokes}
        </g>
      ))}
    </g>
  )
}

export class SpriteShapeUtil extends BaseBoxShapeUtil<SpriteShape> {
  static override type = 'sprite' as const
  static override props: RecordProps<SpriteShape> = {
    w: T.number,
    h: T.number,
    kind: T.string,
    skin: T.string,
    thought: T.string,
    carrying: T.boolean,
    loaded: T.boolean,
    label: T.string,
    color: DefaultColorStyle,
    size: DefaultSizeStyle,
    dash: DefaultDashStyle,
    fill: DefaultFillStyle,
  }

  override getDefaultProps(): SpriteProps {
    return {
      w: 40,
      h: 40,
      kind: 'townsperson',
      skin: '',
      thought: '',
      carrying: false,
      loaded: false,
      label: '',
      color: 'black',
      size: 'm',
      dash: 'draw',
      fill: 'none',
    }
  }

  // Full transform handles: the player can resize and rotate every element.
  // BaseBoxShapeUtil.onResize updates w/h; the render bridge re-centres the
  // sprite from the shape's live bounds, so resizing/rotating stays stable.

  override component(shape: SpriteShape) {
    const { kind, thought, carrying, loaded, label, w, h, color, size, dash, fill } = shape.props
    const skin = shape.props.skin || DEFAULT_SKIN[kind] || ''
    // While carrying, a skin may swap to an alternate pose (svgCarry) — same
    // part order for the rig's legs, only the face/arms differ (+ a held brick).
    const svgParts = (carrying && SVG_RENDER_CARRY[kind]?.[skin]) || SVG_RENDER[kind]?.[skin]
    // Kinds with a walk rig render their leg strokes (or, for an 'svg' skin
    // with no limbs, just the whole body) inside an animated <g> that flips to
    // face travel direction — see AnimatedSprite.
    const rig = WALK_RIG[kind]?.[skin]

    if (svgParts) {
      // One imported part → its <g transform>. Shared so the animated legs
      // render identically to the static body.
      const renderPart = (part: (typeof svgParts)[number], i: number) => (
        <g
          key={i}
          transform={
            part.matrix
              ? `matrix(${part.matrix.join(' ')})`
              : `translate(${part.tx ?? 0} ${part.ty ?? 0}) scale(${part.scale ?? 1})`
          }
        >
          {part.paths.map((p, j) => (
            <path
              key={j}
              d={p.d}
              fill={p.fill}
              stroke={p.stroke}
              strokeWidth={p.strokeWidth}
            />
          ))}
        </g>
      )
      // A skin with a walk rig (e.g. hardhat) pulls its leg parts into animated
      // <g> groups (AnimatedSprite swings them about each hip); the rest of the
      // body renders statically and the whole figure mirrors to face travel.
      const legIdx = rig ? new Set(rig.limbs.flatMap((l) => l.idxs)) : null
      const limbParts = rig ? rig.limbs.map((l) => l.idxs.map((i) => renderPart(svgParts[i], i))) : []
      return (
        <HTMLContainer
          style={{ position: 'relative', width: w, height: h, overflow: 'visible', pointerEvents: 'all' }}
        >
          {thought ? <ThoughtBubble text={thought} w={w} drop={(ART_TOP_FRAC[kind] ?? 0) * h} /> : null}
          <svg
            width={w}
            height={h}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ overflow: 'visible', display: 'block' }}
          >
            {rig ? (
              <AnimatedSprite
                shapeId={shape.id}
                rig={rig}
                bodyStrokes={svgParts.map((part, i) => (legIdx!.has(i) ? null : renderPart(part, i)))}
                limbStrokes={limbParts}
              />
            ) : (
              svgParts.map((part, i) => renderPart(part, i))
            )}
          </svg>
        </HTMLContainer>
      )
    }

    const strokes = DOODLE_RENDER[kind]?.[skin]?.[size] ?? DOODLE_RENDER.townsperson[''].m
    const ink = inkHex(color)
    const fillOn = fill !== 'none'
    const fillCol = !fillOn ? 'none' : fill === 'solid' || fill === 'fill' ? ink : tint(ink, 0.22)

    // One stroke → its SVG. Shared so the animated legs render identically to the
    // static body. In Dash:Draw we fill the freehand outline; otherwise we stroke
    // the centre-line with the current dash style.
    const renderStroke = (st: (typeof strokes)[number], i: number) =>
      dash === 'draw' ? (
        <Fragment key={i}>
          {st.closed && st.bg ? <path d={st.line} fill="#ffffff" stroke="none" /> : null}
          {st.closed && fillOn ? <path d={st.line} fill={fillCol} stroke="none" /> : null}
          <path d={st.draw} fill={ink} stroke="none" />
        </Fragment>
      ) : (
        <path
          key={i}
          d={st.line}
          fill={st.closed && st.bg ? '#ffffff' : st.closed && fillOn ? fillCol : 'none'}
          stroke={ink}
          strokeWidth={st.sw}
          strokeDasharray={dashArray(dash, st.sw)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )

    const legIdx = rig ? new Set(rig.limbs.flatMap((l) => l.idxs)) : null
    const limbStrokes = rig
      ? rig.limbs.map((l) => l.idxs.map((i) => renderStroke(strokes[i], i)))
      : []

    // A vehicle hauling cargo (the truck en route to a drop) rides a little pile
    // of red bricks in its bed. Rendered in the sprite's own ink-independent red
    // (the bricks aren't the truck's colour) and placed inside the flip group so
    // it stays in the bed whichever way the truck is driving.
    const brickInk = inkHex('red')
    const brickFill = tint(brickInk, 0.35)
    const bedBricks = loaded ? (
      <g key="loaded-bricks">
        {TRUCK_BED_BRICKS.map(([bx, by, bw, bh], i) => (
          <rect key={i} x={bx} y={by} width={bw} height={bh} rx={0.7} fill={brickFill} stroke={brickInk} strokeWidth={0.9} />
        ))}
      </g>
    ) : null

    return (
      <HTMLContainer
        style={{
          position: 'relative',
          width: w,
          height: h,
          overflow: 'visible',
          pointerEvents: 'all',
        }}
      >
        {thought ? <ThoughtBubble text={thought} w={w} drop={(ART_TOP_FRAC[kind] ?? 0) * h} /> : null}
        <svg
          width={w}
          height={h}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ overflow: 'visible', display: 'block' }}
        >
          {rig ? (
            <AnimatedSprite
              shapeId={shape.id}
              rig={rig}
              bodyStrokes={[...strokes.map((st, i) => (legIdx!.has(i) ? null : renderStroke(st, i))), bedBricks]}
              limbStrokes={limbStrokes}
            />
          ) : (
            <>
              {strokes.map((st, i) => renderStroke(st, i))}
              {bedBricks}
            </>
          )}
          {kind === 'stall' ? <StoreSign /> : null}
          {kind === 'plantsign' ? <PlantSign label={label} /> : null}
        </svg>
      </HTMLContainer>
    )
  }

  // Sim sprites don't need a selection indicator.
  override getIndicatorPath() {
    return undefined
  }
}
