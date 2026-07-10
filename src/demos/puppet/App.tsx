import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { PuppetStage } from './PuppetStage'

/**
 * Puppet — a VTuber-style rig on the tldraw canvas. Webcam face tracking (and,
 * later, pointer/keyboard) drives a layered puppet through a shared parameter
 * set. This scaffold mounts the editor and overlays a placeholder puppet driven
 * by the live tracking loop; see PLAN.md for the full build.
 */
export default function App() {
	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw persistenceKey="puppet" />
			<div
				style={{
					position: 'absolute',
					top: 8,
					right: 8,
					zIndex: 400,
					width: 300,
					height: 360,
					borderRadius: 12,
					background: 'var(--tl-color-panel, white)',
					boxShadow: 'var(--tl-shadow-2)',
					overflow: 'hidden',
				}}
			>
				<PuppetStage />
			</div>
		</div>
	)
}
