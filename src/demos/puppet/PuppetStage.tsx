import { useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { PuppetDriver } from './rig/driver'
import { NEUTRAL_PARAMS, paramsFromFace, smoothParams, type PuppetParams } from './rig/params'
import { trackFace } from './tracking/faceTracker'

/**
 * The webcam control panel: runs the tracking loop, turns each frame into
 * PuppetParams, smooths them, and drives the on-canvas rig through the shared
 * PuppetDriver. It renders only a small camera preview + status; the puppet
 * itself lives on the tldraw canvas as tagged native shapes.
 */
export function PuppetStage({ editor }: { editor: Editor }) {
	const previewRef = useRef<HTMLVideoElement | null>(null)
	const [status, setStatus] = useState('starting camera…')
	const [tracking, setTracking] = useState(true)
	const trackingRef = useRef(tracking)
	useEffect(() => {
		trackingRef.current = tracking
	}, [tracking])

	useEffect(() => {
		const driver = new PuppetDriver(editor)
		driver.scan()
		// Re-scan when shapes are added/removed/retagged so redrawn features bind live.
		const unsub = editor.store.listen(
			() => driver.scan(),
			{ scope: 'document', source: 'user' }
		)

		let raf = 0
		let stopped = false
		let params: PuppetParams = NEUTRAL_PARAMS
		const video = document.createElement('video')
		video.autoplay = true
		video.playsInline = true
		video.muted = true
		if (previewRef.current) previewRef.current.srcObject = null

		navigator.mediaDevices
			.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
			.then((stream) => {
				video.srcObject = stream
				if (previewRef.current) previewRef.current.srcObject = stream
				return video.play()
			})
			.then(() => {
				setStatus('tracking')
				const loop = async (t: number) => {
					if (stopped) return
					if (trackingRef.current && video.readyState >= 2) {
						const frame = await trackFace(video, t)
						const target = paramsFromFace(frame)
						params = smoothParams(params, target, 0.4)
						driver.apply(params)
					}
					raf = requestAnimationFrame(loop)
				}
				raf = requestAnimationFrame(loop)
			})
			.catch((err) => setStatus(`camera error: ${err?.message ?? err}`))

		return () => {
			stopped = true
			cancelAnimationFrame(raf)
			unsub()
			const s = video.srcObject as MediaStream | null
			s?.getTracks().forEach((tr) => tr.stop())
		}
	}, [editor])

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8 }}>
			<video
				ref={previewRef}
				autoPlay
				playsInline
				muted
				style={{ width: '100%', borderRadius: 8, transform: 'scaleX(-1)', background: '#0002' }}
			/>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<span style={{ font: '12px system-ui', opacity: 0.7 }}>{status}</span>
				<button onClick={() => setTracking((v) => !v)} style={{ font: '12px system-ui', cursor: 'pointer' }}>
					{tracking ? 'Pause' : 'Track'}
				</button>
			</div>
		</div>
	)
}
