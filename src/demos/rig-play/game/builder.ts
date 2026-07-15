/**
 * Engine — the default player: a hand-drawn "builder".
 *
 * The player used to be a blue geo oval. Now it's a little BUILDER — a figure
 * hand-drawn in tldraw (a round head, smiling face, two arms, two legs, a body),
 * captured VERBATIM from the canvas and reproduced here as a GROUP of native
 * shapes marked as the player. So it stays 100% native-first (no custom shape) and
 * plays through the existing group-player rig (game/player.ts): the sim merges the
 * parts into one collision outline and rides the group each frame.
 *
 * EXACT FIDELITY: each shape stores its COMPLETE `props`, including the pen's
 * ORIGINAL delta-encoded `segments` (draw) — the real input path, not a rebuilt
 * outline. createShape gets those props verbatim, so the strokes are a byte-faithful
 * copy of the sketch. Resizing uses tldraw's own `scale` prop (draw) / w·h (geo),
 * never re-running the strokes through perfect-freehand, so the look never drifts.
 *
 * To RE-CAPTURE after redrawing: select the figure in the dev app and run the
 * full-props export snippet, then paste the shapes' `{ type, nx, ny, props }` here.
 */
import { createShapeId, type Editor, type TLShapeId, type TLShapePartial } from 'tldraw'
// b64Vecs encodes draw points into the base64 `path` string a draw segment stores —
// the same encoding the captured builder strokes (arms/torso) use. From tlschema (a
// direct dep) since `tldraw` doesn't re-export it.
import { b64Vecs } from '@tldraw/tlschema'
import { CHARACTER_ROLE } from './body'
import { builderRig, LEG_ANCHORS } from '../rig/builderRig'

/**
 * Capture-order indices of the LIMB shapes in BUILDER_ART.shapes, so the default rig
 * attaches each limb bone to its real leaf id. Verified against the shapes' actual
 * geometric centers (NOT the comment labels, which were unreliable — the old mapping
 * grabbed the SMILE, index 2, as an arm):
 *   0 = right arm  (wide/short, right, mid-body)
 *   3 = left arm   (wide/short, left,  mid-body)
 *   4 = right leg  (tall/narrow, right, bottom) — SKIPPED at create time (Phase B)
 *   5 = left leg   (tall/narrow, left,  bottom) — SKIPPED at create time (Phase B)
 * The head(1), smile(2), torso(6), and eyes(7,8) are NOT rig-driven — they ride the
 * static torso root and stay put.
 *
 * Phase B: the two single-stroke legs (4,5) are NOT reproduced from the capture. Each
 * leg is instead GENERATED as a thigh + shin segment (a two-bone chain so the knee can
 * bend for IK); see LEG_SEGMENT_INDICES / createLegSegment below.
 */
const LIMB_INDEX = { armR: 0, armL: 3 } as const
/** Capture indices of the single-stroke legs we SKIP (replaced by generated segments). */
const SKIP_LEG_INDICES = new Set([4, 5])

/**
 * Capture-order indices of the BODY + FACE shapes the rig's spine/head bones drive
 * (Phase 1' — these used to ride a static root and never move). Verified against the
 * shapes' real geometric centers (see the _idx probe): torso silhouette (6), head
 * ellipse (1), smile (2), and the two eyes (7,8).
 */
const BODY_INDEX = { head: 1, smile: 2, torso: 6, eyeL: 7, eyeR: 8 } as const

/** One captured shape: type, normalized origin, and its COMPLETE props (with the
 *  original `segments` for draw shapes). */
interface BuilderShape {
  type: 'draw' | 'geo'
  nx: number
  ny: number
  props: Record<string, unknown>
}

interface BuilderArt {
  boundsW: number
  boundsH: number
  shapes: BuilderShape[]
}

// ── The builder, captured verbatim (full props, original segments) ──────────
const BUILDER_ART: BuilderArt = {
  boundsW: 62.0190564047582,
  boundsH: 122.7369099390859,
  shapes: [
    // Right arm.
    {
      type: 'draw', nx: 0.7508110147356958, ny: 0.48635782501291513,
      props: { segments: [{ type: 'free', path: 'AAAAAAAAAADDLQAASDUAAHs4AAC4OgAAhTt7LB88ezAAPHswjzp7LNc3rieuM3ssKTQfJQA0AAD2NAAAZjYAAOw1AABINQAAPTYAAI82AADhNgAAjzYAABQ4AADhOHusSDlxsSk6ZrIzO3u0ADxxtSk8w7WaO7i2UjqPtuE4SLU9OFK0KTgAtNc3ALQAOAC0HzVxsQA0rq8KM3GxwzEUshQyzbAKLwqvri+urwovZqquL66vri/DsQovKbCuLxSyri/DsQozALQfNTO39jQzt1I0H7VcMym0wzFcs8MxFLIfMXGxcTFxscMxrq9mKgqv', dim: 2 }], color: 'black', fill: 'none', dash: 'draw', size: 'm', isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1 },
    },
    // Head (geo ellipse) — full geo props.
    {
      type: 'geo', nx: 0.024106602482504073, ny: 0,
      props: { w: 55.4490280356574, h: 52.58219928317396, geo: 'ellipse', dash: 'draw', growY: 0, url: '', scale: 1, color: 'black', labelColor: 'black', fill: 'semi', size: 'l', font: 'draw', align: 'middle', verticalAlign: 'middle', richText: { type: 'doc', content: [{ type: 'paragraph' }] } },
    },
    // Left arm.
    {
      type: 'draw', nx: 0.6892016801164725, ny: 0.23856087895351513,
      props: { segments: [{ type: 'free', path: 'AAAAAAAAAAAAAGYqAAB7MAAAZjIAAFwzAAB7NCmw7DWuszM3rrMKNwC0CjcAtAA4ALThNs2wKTQpsAA0KbAANK6vADQpsAA0e6wANK6ruDKur8Mxrq9cM66vwzEpsBQyrq/DMa6vKTB7sHswuLKuM3u0zTSatXE1M7fhNhS44TYpuBQ2CrcUNhS2HzX2tK4zzbSuM8O1XDPhtsMxSLVmLgC0KTAAtK4vALQpMCm0ri8AtCkwKbQfLQC0risptK4rw7EAABSyrivDsa4rFLIAAHu0rieata4rw7UfJey1AADstQAAw7UAAOy1AAAUtgAA7LUAAM20rqvNtHGxw7Wus7iyzbCurwqvH7Gur8Oxrq8Ush+tw7Guq3uwZq4Kr8OxKbAUssOxw7F7sK6zrq8AtCmwUrQfsQC0rrN7tMOxKbS4sq6zcbHNtCmwzbTDsXu0cbHNtCmwFLKur66vH7FxsQqvcbGuqwqvrqsKrx+pw60Kr66vrq8Kr2aqrq+uqwqvrquur66rCq8Kr66vH60Kr2aqCq9mqq6vH6EKrwAACq8AAGauAABmrmaqZqpmqnusH6EKr2aqrquuq2aq', dim: 2 }], color: 'black', fill: 'none', dash: 'draw', size: 'm', isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1 },
    },
    // Right leg.
    {
      type: 'draw', nx: 0.21412435578923697, ny: 0.47027634368527965,
      props: { segments: [{ type: 'free', path: 'AAAAAAAAAABmqgAAH7EAAFyzAABxsQAAw7EAAPa0H6kUtgqvFLYpsOy1KbA9thSyCrcUshS4KbAUuGayALjDsQC4FLLstSmwSLWuq6S0rqtItQAAcbVmqgC0rqsftXusSLV7rHG1H6WPtnusmrV7rHG1AABxtQAASLUAAHG1AAA9tgAA9rgAAFy5AABcuQAAcbkAAFy5AABcuWYqALquKxS6ezBcuSk0XLlmMki5FDJmth8xFLJ7LMOxHyUptK4rZrKuKxSyeyxcs2YuALSuK7iyeyzDsQovrrN7LCm0eywptK4ve7TNMHG1CjPNtFwzzbSuM7i29jTXt+E2pLgKN7i4XDc9uD02FLgfNey19jRcsx8xe7DDLWauZi57sB8te6xmKmaqCi9mrnssrq+uK3usZi6uqwovZqoKL66rriuuq64rZqoKL66rCi+uq8MtZq7DLQqvKTCurykwCq/DLQqvri8Kr3ExCq8KM3GxXDNcswozcbFcM8OtCi9mqq4rrqtmKgqvZip7rAovrqtmKmaqZip7rK4rZqpmKgAAZi6uq2YqrquuK2YqZipmLgAACi8AAHswAAAfMQAA', dim: 2 }], color: 'black', fill: 'none', dash: 'draw', size: 'm', isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1 },
    },
    // Body-right contour.
    {
      type: 'draw', nx: 0.6591635714854431, ny: 0.7593293868653921,
      props: { segments: [{ type: 'free', path: 'AAAAAAAAAAAAAGYqAABmLgAAZi4AAMMtAABmLgAAKTAAAAovAAAKLwAAri8AAMMxAADDMQAAezAAAFI0AABxNQAAmjUAAB81AAAfNQAA4TYAALg2AAAUNgAACjcAABQ4AAAAOAAASDkAAK43AABINR+pPTZ7sI82e7DDNa6rSDV7rGY2KbBINR+tcTV7rEg1rq+aNSmwHzUpsFI0Zq7DNXGxPThmsvY4zbDNOBSyXDdcswo3uLLXNwC0zThItVw5KbS4OCm0pDgptEg5cbFmNimwADQpsM00KbBINSmwpDQpsAA0KbAANMOxADQUsik0KbCuMymwKTQUsgA0FLIpNB+x9jQKsxQ2rrPsNQC0SDUUsik0w7HNNFyzmjWus8M1ALQUNlyz9jSus800w7GkNAqvcTGuqwovrqfDLa6vri8frQovrqsKL2aqri+uq2YqrquuKwAACi9mqnssZqquK3usritmqmYqZqpmKq6rZq4=', dim: 2 }], color: 'black', fill: 'none', dash: 'draw', size: 'm', isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1 },
    },
    // Left leg.
    {
      type: 'draw', nx: 0.32981848721685514, ny: 0.7727707851887685,
      props: { segments: [{ type: 'free', path: 'AAAAAAAAAAAAAGYqAABmLgAAZi4AAMMtAABmLgAAKTAAAAovAAAKLwAAri8AAMMxAADDMQAAezAAAFI0AABxNQAAmjUAAB81AAAfNQAA4TYAALg2AAAUNgAACjcAABQ4AAAAOAAASDkAAK43AABINR+pPTZ7sI82e7DDNa6rSDV7rGY2KbBINR+tcTV7rEg1rq+aNSmwHzUpsFI0Zq7DNXGxPThmsvY4zbDNOBSyXDdcswo3uLLXNwC0zThItVw5KbS4OCm0pDgptEg5cbFmNimwADQpsM00KbBINSmwpDQpsAA0KbAANMOxADQUsik0KbCuMymwKTQUsgA0FLIpNB+x9jQKsxQ2rrPsNQC0SDUUsik0w7HNNFyzmjWus8M1ALQUNlyz9jSus800w7GkNAqvcTGuqwovrqfDLa6vri8frQovrqsKL2aqri+uq2YqrquuKwAACi9mqnssZqquK3usritmqmYqZqpmKq6rZq4=', dim: 2 }], color: 'black', fill: 'none', dash: 'draw', size: 'm', isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1 },
    },
    // Body silhouette (torso).
    {
      type: 'draw', nx: 0.17828261060956435, ny: 0.3783627577889955,
      props: { segments: [{ type: 'free', path: 'AAAAAAAAAAAAAGYqAAAfLQAAFDIAACk0AABxMQAACi8AAB8xAADDMQAAezAAAAovAACuLwAACi8AAK4vAAB7MAAA9jQAAI82AADsNQAAFDYAAB81AAD2NAAAwzUAAOw1AAApOAAAADoAAI86AAApOAAASDUAAHE1AABINQAAezQAAEg1AABxNQAAADQAAAA0AABINQAAcTUAAAA0AABINQAAhTcAAFw5AAAAOgAAFDoAAAA6AAAUOgAAjzoAAFw7AACFOwAAzToAALg6AACPOgAAjzoAAD04AACPNgAAuDYAAEg1AABxNQAAjzYAAJo1AAAANGYqKTSuKwA0HyFmMgAAwzGuKwA0riv2NB8ppDh7LGY6Zi7NOq4vuDquK7g6Hy24OnsscTsfLXs8eyx7PAAAFDx7LEg7eyw9OAAASDUAAEg1AABINQAApDQAAK4zAAApNAAAADRmKik0risfNR8hcTUAAAA0AAApNK4n9jSuKzM3eywUOK4rjzh7LDM5eyxxOR8l4ThmKoU3risUNgAAzTSuKwozZipcMwAArjMAAMMxHynDLWYqCi8fJQovAACuLwAACi+uK64rritmKmYqritmKnssAAAKL2YqCi+uK2YurieuL2YuCi9xMWYqFDIAAHExAAC4MgAAXDMAAFwzAADNNAAAwzUAAOE2AAAfNQAAwzEAABQyAADDMQAAFDIAAMMxAADDMQAAADQAACk0AAAANAAAHzUAAEg1AACaNQAAFDgAAFI6H6lxO3usmjsKrwA8e6yFPAAAUj0AALg9rqu4PR+tUj3NsNc8zbDDPB+tKTofrQA4e6yPOHusmjl7rDM5rq/NOM2w4Ti4spo5XLOuOcOxzTgfrVI4e6yPNnusuDYfrUg1e6xxNQAAwzUAABQ2AACuNx+pzTgKr1w5ZrK4OLiyFDYfrQA0AADDMQAACi8AAGYurqsKLwqvwy3DrQovrquuL66rCi9mqh8trqtmKq6rZi4fpQovAACuL2aqHy3DscMtKbTDLVK0ritcs64rXLMfJVyzH6EKswAAzbQAAAq3AAApuAAACrcAAOG2AADhtgAAKbQAAMOxAACuswAASLUAAHG1AACPtgAAuLYAAI+2AAAUuAAAALgAAAq3AACPtgAAKbgAAOG4H6kAunusuLofrUi7e6xmvK6n4bwAAOy8AACPvAAAH7x7rHG7e6y4unusXLsfrVy5AAAAuAAAKbh7rM24H61muAAAj7YAANe3AAAAuGaqM7d7rBS4H6EpuAAAj7Z7rLi2e6x7uAAAuLp7rB+7e6w9ugAArrkAAHG5AABIuQAASLkAAHG5e6yFuXusXLkAAM24e6wUuK6rH7UAAEi1H6lxta6rALSup/a0AABItWaqe7SuqwC0H6UptAAAw7EAABSyAAAUsgAArq9mqsOtrqtmrmaqH61mqmaqZqoKr66vCq+uqx8p', dim: 2 }], color: 'black', fill: 'semi', dash: 'draw', size: 's', isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1 },
    },
    // Left eye.
    {
      type: 'draw', nx: 0.31671327188368154, ny: 0.17002377580772973,
      props: { segments: [{ type: 'free', path: 'AAAAAAAAAAAAAGaqAABmrgAACq+uJ3uwrisfsR8le7AAAGauZiquqx8tritmLq4rKTAAAGYuAAAKLwAArisfKQAACi8AAGYuAABmLgAAZi4AAAovAAB7MGaqezDNsHExcbEUMnusri97rK4rZqoKrwAAzbAAAAqvAAAKrwAAe7AAAHGxAAApsAAACq8AAGauAABmrq4rCq9mKq6vAABmrg==', dim: 2 }], color: 'black', fill: 'semi', dash: 'draw', size: 'm', isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1 },
    },
    // Right eye.
    {
      type: 'draw', nx: 0.6892016801164725, ny: 0.1465284010278711,
      props: { segments: [{ type: 'free', path: 'AAAAAAAAAAAAAGaqAABmrgAACq+uJ3uwrisfsR8le7AAAGauZiquqx8tritmLq4rKTAAAGYuAAAKLwAArisfKQAACi8AAGYuAABmLgAAZi4AAAovAAB7MGaqezDNsHExcbEUMnusri97rK4rZqoKrwAAzbAAAAqvAAAKrwAAe7AAAHGxAAApsAAACq8AAGauAABmrq4rCq9mKq6vAABmrg==', dim: 2 }], color: 'black', fill: 'semi', dash: 'draw', size: 'm', isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1 },
    },
  ],
}

/**
 * The player's default height in page px: exactly 2 grid tiles (see roles.ts →
 * TILE), so the drawn builder is ~1 tile wide × 2 tiles tall — the classic
 * side-scroller 1×2 footprint. The width follows proportionally from the art's
 * natural aspect (BUILDER_ART.boundsW/boundsH ≈ 0.505 → ~60.6px, ≈ 1 tile).
 */
export const BUILDER_HEIGHT = 120
export const BUILDER_WIDTH = BUILDER_ART.boundsW * (BUILDER_HEIGHT / BUILDER_ART.boundsH)

/**
 * Create the builder player at page point (x, y) (its TOP-LEFT), sized `heightPx`
 * tall (proportional width; defaults to the natural as-drawn height). Returns the
 * id of the marked group.
 *
 * Reproduces every shape with its COMPLETE captured props (draw segments verbatim).
 * Resizing uses tldraw's `scale` prop (draw) / w·h (geo), so the strokes are never
 * re-run through perfect-freehand and the look stays byte-faithful. Groups the
 * parts and stamps `meta.role = 'player'` — the marker "Set as Player" uses — so
 * the runtime treats it exactly like a user-drawn player.
 */
/**
 * How much the WHOLE leg bows — the perpendicular offset at the leg's midpoint (the
 * knee) as a fraction of the hip→foot length. The leg is drawn as ONE arc from hip to
 * foot broken at the knee (`legArcPaths`); the knee joint sits AT the break, so the
 * thigh and shin are two halves of the same curve and read as one continuous hand-drawn
 * line. Sign leans the bow one way; both legs share it so left and right match.
 */
const LEG_CURVE = -0.14

interface Pt2 { x: number; y: number }

/** A quadratic Bézier point at t∈[0,1] for control points p0 (start), p1 (control), p2 (end). */
function quadAt(p0: Pt2, p1: Pt2, p2: Pt2, t: number): Pt2 {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  }
}

/**
 * ONE curve from hip to foot, bowed by `curve`, BROKEN at its midpoint into two stroke
 * paths (thigh = first half, shin = second half). The knee joint IS that midpoint. Both
 * halves come from the SAME quadratic arc, so the thigh's exit tangent equals the shin's
 * entry tangent at the knee — the two strokes read as one continuous curved line, no kink.
 *
 * Each returned path is LOCAL to its segment's start (thigh origin = hip; shin origin =
 * knee), and `knee` is the page-space split point — the caller uses it BOTH as the shin
 * leaf's origin AND as the shin bone's pivot, so leaf and bone stay perfectly aligned.
 * The curve is cosmetic: the endpoints (hip, knee, foot) are exact, so IK is unaffected.
 */
function legArcPaths(hip: Pt2, foot: Pt2, curve: number): { thighPath: string; shinPath: string; knee: Pt2 } {
  const dx = foot.x - hip.x
  const dy = foot.y - hip.y
  const len = Math.hypot(dx, dy)
  const nx = len ? -dy / len : 0
  const ny = len ? dx / len : 0
  const bow = curve * len
  // Control point pushed 2·bow off the straight midpoint ⇒ the arc's apex (t=½) is `bow`
  // off the hip→foot line. That apex is the knee (the break point).
  const ctrl = { x: hip.x + dx / 2 + nx * 2 * bow, y: hip.y + dy / 2 + ny * 2 * bow }
  const knee = quadAt(hip, ctrl, foot, 0.5)
  const N = 6
  const sample = (t0: number, t1: number, origin: Pt2): Pt2[] => {
    const pts: Pt2[] = []
    for (let i = 0; i <= N; i++) {
      const p = quadAt(hip, ctrl, foot, t0 + (t1 - t0) * (i / N))
      pts.push({ x: p.x - origin.x, y: p.y - origin.y })
    }
    return pts
  }
  return {
    thighPath: b64Vecs.encodePoints2D(sample(0, 0.5, hip)),
    shinPath: b64Vecs.encodePoints2D(sample(0.5, 1, knee)),
    knee,
  }
}

/** A leg SEGMENT's single straight draw segment, from an encoded path. */
function legSegment(path: string) {
  return [{ type: 'free', path, dim: 2 }]
}

/**
 * Create one leg SEGMENT as a native `draw` line, styled like the builder's arms
 * (black, medium, draw dash). The draw origin is placed at page point `origin` (the
 * segment's joint) and `path` is its pre-encoded local stroke. The exact geometry is
 * fixed up later in the rig frame (see the reposition step in createBuilderPlayer); this
 * just creates the leaf so it can be grouped.
 */
function createLegSegment(editor: Editor, origin: Pt2, path: string): TLShapeId {
  const id = createShapeId()
  editor.createShape({
    id,
    type: 'draw',
    x: origin.x,
    y: origin.y,
    rotation: 0,
    props: {
      segments: legSegment(path),
      color: 'black',
      fill: 'none',
      dash: 'draw',
      // 'l' (not 'm'): the captured ARM strokes are dense pen paths whose simulated
      // pressure renders them fuller than a minimal straight line at the same size, so a
      // size 'm' leg reads thinner than a size 'm' arm. Bumping the leg to 'l' matches
      // the arms' visual thickness.
      size: 'l',
      isComplete: true,
      isClosed: false,
      isPen: false,
      scale: 1,
    },
  } as TLShapePartial)
  return id
}

export function createBuilderCharacter(
  editor: Editor,
  x: number,
  y: number,
  heightPx = BUILDER_HEIGHT,
): TLShapeId {
  const scale = heightPx / BUILDER_ART.boundsH
  const figW = BUILDER_ART.boundsW * scale
  const figH = BUILDER_ART.boundsH * scale

  // ids keyed by CAPTURE INDEX so the arm/body lookups stay valid even though we skip
  // the leg strokes (their slots are left undefined and never read).
  const ids: (TLShapeId | undefined)[] = []
  for (let i = 0; i < BUILDER_ART.shapes.length; i++) {
    if (SKIP_LEG_INDICES.has(i)) {
      ids.push(undefined) // legs are generated below, not reproduced
      continue
    }
    const shape = BUILDER_ART.shapes[i]
    const id = createShapeId()
    ids.push(id)
    const ox = x + shape.nx * figW
    const oy = y + shape.ny * figH

    if (shape.type === 'geo') {
      // Full geo props verbatim; w/h rescaled by `scale`.
      const props = {
        ...shape.props,
        w: (shape.props.w as number) * scale,
        h: (shape.props.h as number) * scale,
      }
      editor.createShape({ id, type: 'geo', x: ox, y: oy, props } as TLShapePartial)
      continue
    }

    // Draw: original segments verbatim; resize via the draw `scale` prop, never by
    // rebuilding the stroke — so it stays a byte-faithful copy of the sketch.
    const baseScale = (shape.props.scale as number) ?? 1
    const props = { ...shape.props, scale: baseScale * scale }
    editor.createShape({ id, type: 'draw', x: ox, y: oy, props } as TLShapePartial)
  }

  // Generate the four leg SEGMENTS (thigh + shin per side). Each leg is ONE arc from
  // hip to foot broken at its midpoint (the knee), so the thigh and shin are two halves
  // of the same curve and read as one continuous line. Placeholder geometry here (art
  // frame); the exact arc + knee are recomputed in the RIG frame below (where the rig
  // bones live) so leaf, stroke, and bone all coincide. Page-space point for a coord:
  const pt = (n: { x: number; y: number }) => ({ x: x + n.x * figW, y: y + n.y * figH })
  const arcL = legArcPaths(pt(LEG_ANCHORS.L.joint), pt(LEG_ANCHORS.L.tip), LEG_CURVE)
  const arcR = legArcPaths(pt(LEG_ANCHORS.R.joint), pt(LEG_ANCHORS.R.tip), LEG_CURVE)
  const thighL = createLegSegment(editor, pt(LEG_ANCHORS.L.joint), arcL.thighPath)
  const shinL = createLegSegment(editor, arcL.knee, arcL.shinPath)
  const thighR = createLegSegment(editor, pt(LEG_ANCHORS.R.joint), arcR.thighPath)
  const shinR = createLegSegment(editor, arcR.knee, arcR.shinPath)
  const legIds = [thighL, shinL, thighR, shinR]

  // Group the parts (the reproduced shapes + the generated leg segments) and mark the
  // group as the player.
  const allIds = [...ids.filter((v): v is TLShapeId => v !== undefined), ...legIds]
  const groupId = createShapeId()
  editor.groupShapes(allIds, { groupId })
  const group = editor.getShape(groupId)

  // The rig's entity-local frame is the group's REAL page bounds — the same frame
  // the runtime resolves leaves in (player.ts stores each part's offset relative to
  // the merged page-bounds top-left). The draw strokes extend PAST the art's tight
  // boundsW/boundsH (the arms reach out), so those tight dims are ~30% too narrow;
  // building the rig against them cramps the bones toward center-x (the bones drift
  // off the limbs). Measure the rendered bounds and build the rig against THOSE.
  const groupBounds = editor.getShapePageBounds(groupId)
  const rigW = groupBounds?.w ?? figW
  const rigH = groupBounds?.h ?? figH

  // CRITICAL: the leg SEGMENTS were placed in the ART frame (figW/figH, top-left x,y),
  // but the rig's leg bones are built in the RIG frame (rigW/rigH from the rendered
  // group bounds — wider, because the arm strokes overflow the tight art bounds). Those
  // two frames disagree, so a segment drawn in the art frame doesn't lie on its bone.
  // Recompute each leg's arc in the RIG frame, re-place both strokes, and capture the
  // arc KNEE (its break point) — normalized — so the rig's shin bone pivots THERE and
  // leaf, stroke, and bone all coincide. Knees default to the anchors if bounds are
  // somehow unavailable.
  let kneeL: Pt2 = LEG_ANCHORS.L.knee
  let kneeR: Pt2 = LEG_ANCHORS.R.knee
  if (groupBounds) {
    const rigPt = (n: { x: number; y: number }) => ({ x: groupBounds.minX + n.x * rigW, y: groupBounds.minY + n.y * rigH })
    // Normalize a rig-frame page point back to figure coords (for the rig knee anchor).
    const norm = (p: Pt2) => ({ x: (p.x - groupBounds.minX) / rigW, y: (p.y - groupBounds.minY) / rigH })
    const placeArc = (thighId: TLShapeId, shinId: TLShapeId, joint: Pt2, tip: Pt2) => {
      const hip = rigPt(joint)
      const foot = rigPt(tip)
      const arc = legArcPaths(hip, foot, LEG_CURVE)
      const setLeaf = (leafId: TLShapeId, origin: Pt2, path: string) => {
        const local = editor.getShapeParentTransform(leafId).clone().invert().applyToPoint(origin)
        const props = editor.getShape(leafId)?.props as Record<string, unknown> | undefined
        editor.updateShape({ id: leafId, type: 'draw', x: local.x, y: local.y, rotation: 0, props: { ...props, segments: legSegment(path) } } as TLShapePartial)
      }
      setLeaf(thighId, hip, arc.thighPath)
      setLeaf(shinId, arc.knee, arc.shinPath)
      return norm(arc.knee)
    }
    kneeL = placeArc(thighL, shinL, LEG_ANCHORS.L.joint, LEG_ANCHORS.L.tip)
    kneeR = placeArc(thighR, shinR, LEG_ANCHORS.R.joint, LEG_ANCHORS.R.tip)
  }

  // Default rig (R2): a Tier-A skeleton — a pelvis→spine→head chain plus L/R arm+leg
  // bones — attached to the real leaf ids, so the default player's WHOLE BODY animates
  // on Play (the state machine in game/rig/walk.ts supplies the live pose). Entity-local
  // px = the rendered figure's page-bounds size.
  const rig = builderRig(rigW, rigH, {
    armL: ids[LIMB_INDEX.armL]!,
    armR: ids[LIMB_INDEX.armR]!,
    thighL,
    shinL,
    thighR,
    shinR,
    torso: ids[BODY_INDEX.torso]!,
    head: ids[BODY_INDEX.head]!,
    smile: ids[BODY_INDEX.smile]!,
    eyeL: ids[BODY_INDEX.eyeL]!,
    eyeR: ids[BODY_INDEX.eyeR]!,
  }, { L: kneeL, R: kneeR })

  editor.updateShape({
    id: groupId,
    type: group?.type ?? 'group',
    // Rig is plain data; cast through unknown to tldraw's JsonObject meta (an
    // interface has no index signature — the shell CLAUDE.md pattern).
    meta: { ...(group?.meta ?? {}), role: CHARACTER_ROLE, rig: rig as unknown as Record<string, never> },
  } as TLShapePartial)

  return groupId
}
