// Win detection + the "You Win" dialog. Renders nothing on the canvas — a headless
// watcher mounted inside the editor context (alongside RunController/Field via the
// InFrontOfTheCanvas slot).
//
// The win is a DISPLAY concern, detected per-client: the object's live pose is
// already broadcast into objPoseAtom (netPose.ts) and drawn by Field, so each
// client just watches that pose and checks whether the object has reached the goal
// flag (getFlagBounds — the flag's real page-space bounds, read live so a moved
// flag still scores). No DO/protocol change needed; every client sees the same
// pose, so every client pops the same dialog.
//
// We use tldraw's NATIVE dialog UI (useDialogs + TldrawUiDialog* primitives). The
// dialog's Reset runs the shared resetGame — same path as the panel's reset.

import { useEffect, useRef } from 'react'
import {
	useEditor,
	useValue,
	useDialogs,
	TldrawUiDialogHeader,
	TldrawUiDialogTitle,
	TldrawUiDialogBody,
	TldrawUiDialogFooter,
	TldrawUiButton,
	TldrawUiButtonLabel,
	type Editor,
} from 'tldraw'
import { objPoseAtom, playingAtom } from './state'
import { getFlagBounds } from './shapes'
import { resetGame } from './seed'

/** The native "You Win!" dialog: a title + a single Reset button. `onClose` is
 * injected by useDialogs; Reset resets the game and dismisses. */
function WinDialog({ onClose, editor }: { onClose(): void; editor: Editor }) {
	return (
		<>
			<TldrawUiDialogHeader>
				<TldrawUiDialogTitle>You Win! 🎉</TldrawUiDialogTitle>
			</TldrawUiDialogHeader>
			<TldrawUiDialogBody style={{ maxWidth: 320 }}>
				You threaded the load through the maze and reached the flag.
			</TldrawUiDialogBody>
			<TldrawUiDialogFooter className="tlui-dialog__footer__actions">
				<TldrawUiButton
					type="primary"
					onClick={() => {
						resetGame(editor)
						onClose()
					}}
				>
					<TldrawUiButtonLabel>↺ Reset</TldrawUiButtonLabel>
				</TldrawUiButton>
			</TldrawUiDialogFooter>
		</>
	)
}

export function WinWatcher() {
	const editor = useEditor()
	const { addDialog } = useDialogs()
	const playing = useValue('am-playing', () => playingAtom.get(), [])
	// Once we've popped the win dialog for the current run, don't pop it again every
	// frame the object sits on the flag. Cleared when the run ends (playing → false),
	// so the next run can win afresh.
	const wonRef = useRef(false)

	useEffect(() => {
		if (!playing) {
			wonRef.current = false
			return
		}
		// Poll the (already-interpolated) object pose against the flag bounds. rAF
		// would be smoother, but the win is a coarse zone test — a light interval is
		// plenty and avoids a per-frame render subscription.
		const id = setInterval(() => {
			if (wonRef.current) return
			const flag = getFlagBounds(editor)
			if (!flag) return
			const p = objPoseAtom.get()
			// The object's pose center inside the flag's bounds counts as reaching it.
			if (p.x >= flag.minX && p.x <= flag.maxX && p.y >= flag.minY && p.y <= flag.maxY) {
				wonRef.current = true
				addDialog({ component: (props) => <WinDialog {...props} editor={editor} /> })
			}
		}, 100)
		return () => clearInterval(id)
	}, [editor, playing, addDialog])

	return null
}
