/**
 * WORLD CONTROLS — the world-style picker overlaid on the canvas.
 * ===================================================================
 * A small button group naming the available world STYLES (styles.ts). Picking one
 * rebuilds the whole nested world in place under that style (gameLoop's regenerate),
 * so you can watch the same zoom mechanic produce corner-nested vs. concentric vs.
 * scattered rooms, plain or textured. Rendered via a tldraw `components` slot
 * (Toolbar/StylePanel are nulled, so the canvas is otherwise clear).
 *
 * It owns no game state — the active style and the regenerate callback are passed in
 * from App, which holds the live game handle. Pointer events are stopped so clicking a
 * button never falls through to the canvas (and can't nudge the player).
 */
import { STYLE_LABELS, STYLE_ORDER, type StyleName } from './styles'

export type WorldControlsProps = {
	style: StyleName
	onPick: (style: StyleName) => void
}

export function WorldControls({ style, onPick }: WorldControlsProps) {
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
			<div style={{ fontWeight: 600, color: '#555', letterSpacing: 0.2 }}>World style</div>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 220 }}>
				{STYLE_ORDER.map((name) => {
					const active = name === style
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
							{STYLE_LABELS[name]}
						</button>
					)
				})}
			</div>
		</div>
	)
}
