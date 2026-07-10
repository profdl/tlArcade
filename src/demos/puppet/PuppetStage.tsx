import { useEffect, useRef, useState } from 'react'
import { trackFace } from './tracking/faceTracker'
import { NEUTRAL_PARAMS, paramsFromFace, smoothParams, type PuppetParams } from './rig/params'

/**
 * Scaffold puppet: a plain SVG face driven live by the shared PuppetParams. It
 * exists to prove the webcam → tracker → params → render loop end-to-end. The
 * real demo (see PLAN.md) replaces this with a layered tldraw-shape rig on the
 * canvas; the params contract stays identical.
 */
export function PuppetStage() {
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const paramsRef = useRef<PuppetParams>(NEUTRAL_PARAMS)
	const [params, setParams] = useState<PuppetParams>(NEUTRAL_PARAMS)
	const [status, setStatus] = useState('starting camera…')

	useEffect(() => {
		let raf = 0
		let stopped = false
		const video = document.createElement('video')
		video.autoplay = true
		video.playsInline = true
		video.muted = true
		videoRef.current = video

		navigator.mediaDevices
			.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
			.then((stream) => {
				video.srcObject = stream
				return video.play()
			})
			.then(() => {
				setStatus('tracking')
				const loop = async (t: number) => {
					if (stopped) return
					if (video.readyState >= 2) {
						const frame = await trackFace(video, t)
						const target = paramsFromFace(frame)
						paramsRef.current = smoothParams(paramsRef.current, target, 0.4)
						setParams(paramsRef.current)
					}
					raf = requestAnimationFrame(loop)
				}
				raf = requestAnimationFrame(loop)
			})
			.catch((err) => setStatus(`camera error: ${err?.message ?? err}`))

		return () => {
			stopped = true
			cancelAnimationFrame(raf)
			const s = video.srcObject as MediaStream | null
			s?.getTracks().forEach((tr) => tr.stop())
		}
	}, [])

	const p = params
	const eyeH = (open: number) => 3 + open * 22
	return (
		<div style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 12 }}>
			<svg width={260} height={300} viewBox="0 0 260 300">
				<g transform={`translate(130 150) rotate(${(p.headRoll * 180) / Math.PI}) translate(${p.headYaw * 60} ${-p.headPitch * 60})`}>
					<ellipse cx={0} cy={0} rx={90} ry={110} fill="#f6d9c2" stroke="#caa" />
					{/* brows */}
					<rect x={-58} y={-52 - p.eyeBrowL * 12} width={40} height={6} rx={3} fill="#7a5" transform={`rotate(${-p.eyeBrowL * 8} -38 -50)`} />
					<rect x={18} y={-52 - p.eyeBrowR * 12} width={40} height={6} rx={3} fill="#7a5" transform={`rotate(${p.eyeBrowR * 8} 38 -50)`} />
					{/* eyes */}
					<ellipse cx={-38} cy={-20} rx={22} ry={eyeH(p.eyeOpenL)} fill="#fff" stroke="#333" />
					<ellipse cx={38} cy={-20} rx={22} ry={eyeH(p.eyeOpenR)} fill="#fff" stroke="#333" />
					<circle cx={-38 + p.gazeX * 12} cy={-20 + p.gazeY * 10} r={8} fill="#333" />
					<circle cx={38 + p.gazeX * 12} cy={-20 + p.gazeY * 10} r={8} fill="#333" />
					{/* mouth: width from mouthWide/smile, height from mouthOpen */}
					<ellipse
						cx={0}
						cy={55 - p.mouthSmile * 8}
						rx={22 + p.mouthWide * 18}
						ry={4 + p.mouthOpen * 28}
						fill="#a33"
						stroke="#822"
					/>
				</g>
			</svg>
			<div style={{ font: '13px system-ui', opacity: 0.7 }}>{status}</div>
		</div>
	)
}
