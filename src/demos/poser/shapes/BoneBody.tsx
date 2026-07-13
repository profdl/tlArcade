import {
	getColorValue,
	getStrokePoints,
	getSvgPathFromStrokePoints,
	SVGContainer,
	useEditor,
	useValue,
	type TLDefaultDashStyle,
	type TLDefaultFillStyle,
	type TLDefaultSizeStyle,
} from 'tldraw'
import { boneThickness, type BoneShape } from './boneShape'

// Native stroke weight per size step (tldraw's STROKE_SIZES isn't exported; mirror
// it, like CreatureShape does). Multiplied by the theme's base strokeWidth.
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 1, m: 1.75, l: 2.5, xl: 3.5 }

// fill style → which theme color variant fills the interior (null = no fill).
// 'pattern'/'lined-fill' are approximated by their semi tint (no hatch SVG), the
// same simplification CreatureShape uses.
const FILL_VARIANT: Record<TLDefaultFillStyle, 'solid' | 'semi' | 'fill' | null> = {
	none: null,
	semi: 'semi',
	solid: 'fill',
	fill: 'fill',
	pattern: 'semi',
	'lined-fill': 'semi',
}

/**
 * The on-canvas render of a bone: a stadium (rounded-oval capsule) from the head
 * (local origin) to the tail (local `length, 0`), styled with the full native geo
 * style set — outline `color`, `size` (stroke weight), `dash`, and `fill`. A hub
 * dot marks each joint. With `dash === 'draw'` the outline is a hand-drawn
 * perfect-freehand stroke instead of a clean one.
 *
 * Split out from BoneShapeUtil so it can use hooks to resolve theme colors
 * reactively, and so the util file exports only the class (react-refresh rule).
 */
export function BoneBody({ shape }: { shape: BoneShape }) {
	const { length, color, size, dash, fill } = shape.props
	const thickness = boneThickness(shape)
	const editor = useEditor()

	// Resolve theme-dependent display values reactively — re-renders on palette /
	// dark-mode change. Mirrors how built-in shapes resolve stroke/fill/width.
	const { stroke, fillColor, strokeWidth, hubFill } = useValue(
		'boneDisplay',
		() => {
			const theme = editor.getCurrentTheme()
			const colors = theme.colors[editor.getColorMode()]
			const variant = FILL_VARIANT[fill]
			return {
				stroke: getColorValue(colors, color, 'solid'),
				fillColor: variant === null ? 'none' : getColorValue(colors, color, variant),
				strokeWidth: theme.strokeWidth * STROKE_SIZES[size],
				hubFill: colors.background,
			}
		},
		[editor, color, size, fill]
	)

	const r = thickness / 2
	const hub = Math.max(2.5, thickness * 0.24)
	const outline = dash === 'draw' ? capsuleFreehandPath(length, thickness) : stadiumPath(length, r)
	// tldraw's 'dashed'/'dotted' outline patterns, approximated with SVG dash arrays.
	const dashArray = strokeDashArray(dash, strokeWidth)

	return (
		<SVGContainer>
			<path
				d={outline}
				fill={fillColor}
				stroke={stroke}
				strokeWidth={strokeWidth}
				strokeDasharray={dashArray}
				strokeLinejoin="round"
			/>
			{/* joint hubs — background-toned dots so the articulation points are legible */}
			<circle cx={0} cy={0} r={hub} fill={hubFill} stroke={stroke} strokeWidth={strokeWidth} />
			<circle cx={length} cy={0} r={hub * 0.85} fill={hubFill} stroke={stroke} strokeWidth={strokeWidth} />
		</SVGContainer>
	)
}

/**
 * A closed stadium (rounded oval capsule) outline from head (0,0) to tail
 * (length,0), radius `r`. Two straight sides joined by semicircular caps — an
 * oval stretched along the bone, exactly the silhouette a geo oval gives.
 */
function stadiumPath(length: number, r: number): string {
	// top edge L→R, right cap (semicircle), bottom edge R→L, left cap.
	return [
		`M 0 ${-r}`,
		`L ${length} ${-r}`,
		`A ${r} ${r} 0 0 1 ${length} ${r}`,
		`L 0 ${r}`,
		`A ${r} ${r} 0 0 1 0 ${-r}`,
		'Z',
	].join(' ')
}

/** SVG dash array for a native dash style (undefined = solid/draw = continuous). */
function strokeDashArray(dash: TLDefaultDashStyle, w: number): string | undefined {
	if (dash === 'dashed') return `${w * 2} ${w * 2}`
	if (dash === 'dotted') return `${w * 0.1} ${w * 2}`
	return undefined // 'solid' and 'draw' render continuous
}

/**
 * A hand-drawn capsule outline via tldraw's perfect-freehand pipeline. We trace
 * the capsule silhouette as raw points and feed them through getStrokePoints ->
 * getSvgPathFromStrokePoints as a closed path. Pure function of length/thickness,
 * so the outline is stable while posing (no per-frame shimmer).
 */
function capsuleFreehandPath(length: number, thickness: number): string {
	const r = thickness / 2
	const raw = [
		{ x: 0, y: -r },
		{ x: length, y: -r },
		{ x: length + r, y: 0 },
		{ x: length, y: r },
		{ x: 0, y: r },
		{ x: -r, y: 0 },
		{ x: 0, y: -r },
	]
	const strokePoints = getStrokePoints(raw, { size: thickness, streamline: 0.3 })
	return getSvgPathFromStrokePoints(strokePoints, true)
}
