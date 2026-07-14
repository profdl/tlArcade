/**
 * WORLD CONTROLS — the map-complexity picker overlaid on the canvas.
 * ===================================================================
 * A small button group naming the available map PATTERNS (patterns.ts). Picking one
 * rebuilds the whole nested world in place under that pattern (gameLoop's regenerate),
 * so you can watch the same zoom mechanic produce a plain grid vs. a self-similar
 * Sierpiński carpet vs. organic clusters. Rendered via a tldraw `components` slot
 * (Toolbar/StylePanel are nulled, so the canvas is otherwise clear).
 *
 * It owns no game state — the active pattern and the regenerate callback are passed in
 * from App, which holds the live game handle. Pointer events are stopped so clicking a
 * button never falls through to the canvas (and can't nudge the player).
 */
import { PATTERN_LABELS, PATTERN_ORDER, type PatternName } from './patterns'

export type WorldControlsProps = {
	pattern: PatternName
	onPick: (pattern: PatternName) => void
}

export function WorldControls({ pattern, onPick }: WorldControlsProps) {
	return (
		<div
			style={{
				position: 'absolute',
				top: 12,
				left: 12,
				zIndex: 300,
				display: 'flex',
				flexDirection: 'column',
				gap: 6,
				padding: 10,
				borderRadius: 10,
				background: 'rgba(255,255,255,0.92)',
				boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
				font: '13px/1.2 system-ui, sans-serif',
				pointerEvents: 'all',
			}}
			// Keep clicks/drags on the panel from reaching the canvas (no player nudge, no pan).
			onPointerDown={(e) => e.stopPropagation()}
			onPointerMove={(e) => e.stopPropagation()}
			onWheel={(e) => e.stopPropagation()}
		>
			<div style={{ fontWeight: 600, color: '#555', letterSpacing: 0.2 }}>Map pattern</div>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 220 }}>
				{PATTERN_ORDER.map((name) => {
					const active = name === pattern
					return (
						<button
							key={name}
							onClick={() => onPick(name)}
							style={{
								padding: '5px 10px',
								borderRadius: 7,
								border: active ? '1.5px solid #2563eb' : '1px solid #ccc',
								background: active ? '#2563eb' : '#fff',
								color: active ? '#fff' : '#333',
								fontWeight: active ? 600 : 400,
								cursor: 'pointer',
							}}
						>
							{PATTERN_LABELS[name]}
						</button>
					)
				})}
			</div>
		</div>
	)
}
