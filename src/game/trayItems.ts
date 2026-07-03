// Presets for the drag-and-drop tray: native shape groups a player can drag
// onto the canvas instead of hand-authoring them. The portal (two geo mouths
// bound by an arrow) and the multiplier (one entrance mouth bound to two exit
// mouths by two arrows), per geometry.ts's portal/multiplier grouping contract.
import { createShapeId, type Editor, type TLDefaultColorStyle } from 'tldraw'

export interface TrayItem {
	id: string
	label: string
	/** Swatch color shown in the tray row (CSS color, not a tldraw color name). */
	swatch: string
	/** Create the native shape(s) for this item, centered on `point` (page space). */
	create: (editor: Editor, point: { x: number; y: number }) => void
}

// 3x a "reads as a UI swatch" size so a dropped piece reads clearly at a
// normal working zoom, not a sliver.
const TRAY_SCALE = 3

// A portal mouth is a plain geo rectangle (per geometry.ts's contract: any geo
// shape bound to both ends of an arrow becomes a portal). Square and outlined
// (no fill) so it reads as a "frame" rather than a track-color bar.
const PORTAL_MOUTH_SIZE = 60 * TRAY_SCALE
// Horizontal gap between the two mouths, so the linking arrow has room to read
// as a connector rather than overlapping either box. Scaled with the mouths so
// the arrow-to-mouth proportions stay the same as the un-scaled design.
const PORTAL_GAP = 140 * TRAY_SCALE

// A multiplier reuses the portal mouth's exact size/gap for its entrance and
// exits, plus this vertical offset to spread the two exits apart (one above,
// one below the entrance's row) so the two linking arrows read as diverging
// paths rather than overlapping.
const MULTIPLIER_EXIT_OFFSET_Y = 100 * TRAY_SCALE

export const TRAY_ITEMS: TrayItem[] = [
	{
		id: 'portal',
		label: 'Portal',
		swatch: '#7048e8',
		// Per geometry.ts's portal contract: an arrow bound at BOTH terminals to
		// geo shapes. Drop point becomes the entrance mouth's center; the exit
		// mouth is placed PORTAL_GAP to the right. Mirrors what a user gets by
		// hand-drawing two boxes and connecting them with the arrow tool.
		create: (editor, point) => {
			const entranceId = createShapeId()
			const exitId = createShapeId()
			const arrowId = createShapeId()

			const entranceX = point.x - PORTAL_MOUTH_SIZE / 2
			const entranceY = point.y - PORTAL_MOUTH_SIZE / 2
			const exitX = entranceX + PORTAL_MOUTH_SIZE + PORTAL_GAP

			const portalColor: TLDefaultColorStyle = 'blue'
			const mouthProps = {
				geo: 'rectangle' as const,
				w: PORTAL_MOUTH_SIZE,
				h: PORTAL_MOUTH_SIZE,
				color: portalColor,
				fill: 'none' as const,
				dash: 'solid' as const,
			}

			editor.createShapes([
				{ id: entranceId, type: 'geo', x: entranceX, y: entranceY, props: mouthProps },
				{ id: exitId, type: 'geo', x: exitX, y: entranceY, props: mouthProps },
				{
					id: arrowId,
					type: 'arrow',
					x: point.x,
					y: point.y,
					props: {
						start: { x: 0, y: 0 },
						end: { x: exitX + PORTAL_MOUTH_SIZE / 2 - point.x, y: 0 },
						color: portalColor,
					},
				},
			])

			editor.createBindings([
				{
					type: 'arrow',
					fromId: arrowId,
					toId: entranceId,
					props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: false, isExact: false, snap: 'none' },
				},
				{
					type: 'arrow',
					fromId: arrowId,
					toId: exitId,
					props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: false, isExact: false, snap: 'none' },
				},
			])
		},
	},
	{
		id: 'multiplier',
		label: 'Multiplier',
		swatch: '#e64980',
		// Per geometry.ts's grouping contract: an entrance geo shape wired to TWO
		// exit geo shapes by two separate arrows. Drop point becomes the entrance
		// mouth's center; the exits sit PORTAL_GAP to the right, offset up/down by
		// MULTIPLIER_EXIT_OFFSET_Y so the two linking arrows diverge instead of
		// overlapping. Colored violet (vs. the portal's blue) so it reads as a
		// distinct piece on the canvas even before Play.
		create: (editor, point) => {
			const entranceId = createShapeId()
			const exitAId = createShapeId()
			const exitBId = createShapeId()
			const arrowAId = createShapeId()
			const arrowBId = createShapeId()

			const entranceX = point.x - PORTAL_MOUTH_SIZE / 2
			const entranceY = point.y - PORTAL_MOUTH_SIZE / 2
			const exitX = entranceX + PORTAL_MOUTH_SIZE + PORTAL_GAP
			const exitAY = entranceY - MULTIPLIER_EXIT_OFFSET_Y
			const exitBY = entranceY + MULTIPLIER_EXIT_OFFSET_Y

			const multiplierColor: TLDefaultColorStyle = 'violet'
			const mouthProps = {
				geo: 'rectangle' as const,
				w: PORTAL_MOUTH_SIZE,
				h: PORTAL_MOUTH_SIZE,
				color: multiplierColor,
				fill: 'none' as const,
				dash: 'solid' as const,
			}

			editor.createShapes([
				{ id: entranceId, type: 'geo', x: entranceX, y: entranceY, props: mouthProps },
				{ id: exitAId, type: 'geo', x: exitX, y: exitAY, props: mouthProps },
				{ id: exitBId, type: 'geo', x: exitX, y: exitBY, props: mouthProps },
				{
					id: arrowAId,
					type: 'arrow',
					x: point.x,
					y: point.y,
					props: {
						start: { x: 0, y: 0 },
						end: { x: exitX + PORTAL_MOUTH_SIZE / 2 - point.x, y: exitAY + PORTAL_MOUTH_SIZE / 2 - point.y },
						color: multiplierColor,
					},
				},
				{
					id: arrowBId,
					type: 'arrow',
					x: point.x,
					y: point.y,
					props: {
						start: { x: 0, y: 0 },
						end: { x: exitX + PORTAL_MOUTH_SIZE / 2 - point.x, y: exitBY + PORTAL_MOUTH_SIZE / 2 - point.y },
						color: multiplierColor,
					},
				},
			])

			editor.createBindings([
				{
					type: 'arrow',
					fromId: arrowAId,
					toId: entranceId,
					props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: false, isExact: false, snap: 'none' },
				},
				{
					type: 'arrow',
					fromId: arrowAId,
					toId: exitAId,
					props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: false, isExact: false, snap: 'none' },
				},
				{
					type: 'arrow',
					fromId: arrowBId,
					toId: entranceId,
					props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: false, isExact: false, snap: 'none' },
				},
				{
					type: 'arrow',
					fromId: arrowBId,
					toId: exitBId,
					props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: false, isExact: false, snap: 'none' },
				},
			])
		},
	},
]
