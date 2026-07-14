// Client → server input: the dedicated upstream channel the sync socket can't
// provide (skill rules 1/2). Opens a plain WebSocket to /api/am/input/:roomId and
// sends InputMsg — grabs (during play) and start/stop control frames.
//
// The socket is opened with ?sessionId=TAB_ID (== AM_SESSION_ID), the SAME id
// useSync uses on its sync socket, so the DO ties this player's grabs to their
// pose-receive as one player and can flag their own rope back.
//
// Pointer handling mirrors the old client-authoritative RunController: capture-
// phase pointerdown on the editor container so a drag on the object becomes a grab
// regardless of the active tool. On down we hit-test locally (hit.ts) against the
// latest broadcast pose+shape to get the body-local anchor; while held we send
// coalesced {grab} frames; on up we send {release}.

import { useCallback, useEffect, useRef } from 'react'
import { useEditor } from 'tldraw'
import { AM_SESSION_ID } from './netPose'
import { objPoseAtom, objShapeAtom, playingAtom } from './state'
import { hitTestLocal } from './hit'
import type { InputMsg } from './protocol'

/** Coalesce grab sends to ~20 Hz — a player doesn't re-aim every frame, and the
 *  sim holds the last cursor between messages, so flooding the socket buys nothing. */
const SEND_INTERVAL_MS = 50

export interface AmInput {
	/** Send a control frame (start/stop) immediately. Used by the Play/Stop panel. */
	send: (msg: InputMsg) => void
	/** Is the input socket currently open? */
	isOpen: () => boolean
}

/**
 * Manage the input socket + pointer→grab handling for a room. Returns a `send`
 * for control frames (start/stop). Grabs are sent internally from pointer events.
 */
export function useAmInput(roomId: string | undefined): AmInput {
	const editor = useEditor()
	const wsRef = useRef<WebSocket | null>(null)
	const openRef = useRef(false)

	// Body-local anchor of the current grab (planck meters), or null if not holding.
	const anchorRef = useRef<{ x: number; y: number } | null>(null)
	// Last coalesced-send timestamp + the latest cursor to send at the next tick.
	const lastSentRef = useRef(0)
	const pendingCursorRef = useRef<{ x: number; y: number } | null>(null)

	const send = useCallback((msg: InputMsg) => {
		const ws = wsRef.current
		if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
	}, [])

	// --- Socket lifecycle (per room) ---
	useEffect(() => {
		if (!roomId) return
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
		const uri = `${proto}//${window.location.host}/api/am/input/${roomId}?sessionId=${AM_SESSION_ID}`
		const ws = new WebSocket(uri)
		wsRef.current = ws
		ws.onopen = () => {
			openRef.current = true
		}
		ws.onclose = () => {
			openRef.current = false
		}
		ws.onerror = () => {
			openRef.current = false
		}
		return () => {
			openRef.current = false
			wsRef.current = null
			ws.close()
		}
	}, [roomId])

	// --- Pointer → grab handling ---
	useEffect(() => {
		const container = editor.getContainer()
		const pagePointFromEvent = (e: PointerEvent) =>
			editor.screenToPage({ x: e.clientX, y: e.clientY })

		const sendGrab = (cursor: { x: number; y: number }, force: boolean) => {
			const anchor = anchorRef.current
			if (!anchor) return
			const now = performance.now()
			pendingCursorRef.current = cursor
			if (!force && now - lastSentRef.current < SEND_INTERVAL_MS) return
			lastSentRef.current = now
			send({ type: 'grab', anchor, cursor })
			pendingCursorRef.current = null
		}

		const onDown = (e: PointerEvent) => {
			if (!playingAtom.get()) return
			const shape = objShapeAtom.get()
			if (!shape) return
			const p = pagePointFromEvent(e)
			const anchor = hitTestLocal(shape, objPoseAtom.get(), p)
			if (anchor) {
				anchorRef.current = anchor
				sendGrab({ x: p.x, y: p.y }, true)
				// This drag is a GRAB, not a canvas gesture — claim it so tldraw never
				// starts a brush-select / shape drag.
				e.stopPropagation()
				e.preventDefault()
			}
		}
		const onMove = (e: PointerEvent) => {
			if (!anchorRef.current) return
			const p = pagePointFromEvent(e)
			sendGrab({ x: p.x, y: p.y }, false)
		}
		const onUp = () => {
			if (!anchorRef.current) return
			anchorRef.current = null
			pendingCursorRef.current = null
			send({ type: 'release' })
		}

		container.addEventListener('pointerdown', onDown, { capture: true })
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
		return () => {
			container.removeEventListener('pointerdown', onDown, {
				capture: true,
			} as EventListenerOptions)
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
		}
	}, [editor, send])

	// Flush a coalesced cursor that arrived mid-interval, so the last aim isn't lost
	// when the pointer stops moving (otherwise the sim holds a slightly stale cursor).
	useEffect(() => {
		const id = setInterval(() => {
			const cursor = pendingCursorRef.current
			const anchor = anchorRef.current
			if (cursor && anchor) {
				lastSentRef.current = performance.now()
				pendingCursorRef.current = null
				send({ type: 'grab', anchor, cursor })
			}
		}, SEND_INTERVAL_MS)
		return () => clearInterval(id)
	}, [send])

	return { send, isOpen: () => openRef.current }
}
