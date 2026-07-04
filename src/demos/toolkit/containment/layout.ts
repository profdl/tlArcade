/**
 * CONTAINER LAYOUT ENGINES  (SPEC §5.5)
 * =====================================
 * Pure functions that compute child positions inside a container. No editor, no
 * React — so they're trivially testable. Each returns the page-space (x, y) for
 * each child, given the container's page-space top-left + size and the children
 * in binding order.
 */
export type LayoutKind = 'autoGrid' | 'stack' | 'fan'

export interface ChildSize {
	w: number
	h: number
}

export interface Placement {
	x: number
	y: number
}

const PAD = 8

/** Compute placements for `children` inside a container at (cx, cy) of size (cw, ch). */
export function layoutChildren(
	kind: LayoutKind,
	cx: number,
	cy: number,
	cw: number,
	ch: number,
	children: ChildSize[]
): Placement[] {
	switch (kind) {
		case 'stack':
			// A pile: each child offset slightly down-right from the last (a deck).
			return children.map((_, i) => ({ x: cx + PAD + i * 2, y: cy + PAD + i * 2 }))

		case 'fan': {
			// Spread children left→right across the width (a hand).
			const n = Math.max(1, children.length)
			const usable = cw - PAD * 2
			return children.map((c, i) => ({
				x: cx + PAD + (n === 1 ? 0 : (usable - c.w) * (i / (n - 1))),
				y: cy + ch - PAD - c.h,
			}))
		}

		case 'autoGrid':
		default: {
			// Pack into a grid sized to the first child (or a default cell).
			const cell = children[0] ?? { w: 40, h: 40 }
			const cols = Math.max(1, Math.floor((cw - PAD) / (cell.w + PAD)))
			return children.map((_, i) => ({
				x: cx + PAD + (i % cols) * (cell.w + PAD),
				y: cy + PAD + Math.floor(i / cols) * (cell.h + PAD),
			}))
		}
	}
}
