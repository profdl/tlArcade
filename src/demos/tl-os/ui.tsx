/**
 * tl-os — the tldraw-native UI pieces (dialog + bind panel).
 *
 * These render *inside* <Tldraw>'s UI context (injected via the `components`
 * prop, or opened through `useDialogs`), so they get tldraw's theming, dark
 * mode, focus handling, and button styling for free. The App owns all the
 * bind/import state and hands it down through TlosUiContext.
 */
/* eslint-disable react-refresh/only-export-components -- this UI module
   necessarily co-locates its context provider + hooks with the components that
   consume them; splitting them across files for fast-refresh's sake would
   fragment one cohesive UI unit. Fast refresh falls back to a reload here. */
import { createContext, useCallback, useContext } from 'react'
import {
	TldrawUiButton,
	TldrawUiButtonLabel,
	TldrawUiDialogBody,
	TldrawUiDialogCloseButton,
	TldrawUiDialogFooter,
	TldrawUiDialogHeader,
	TldrawUiDialogTitle,
	useDialogs,
	type TLUiDialogProps,
} from 'tldraw'
import type { FileShape } from './FileShapeUtil'

/** Bind state + actions the App shares with tldraw-mounted UI components. */
export interface TlosUi {
	status: 'loading' | 'unsupported' | 'none' | 'reconnect' | 'bound'
	rootName: string | null
	busy: boolean
	/** Open the Finder view. Reopens the bound folder if one is remembered;
	 *  re-grants a lapsed permission; otherwise opens the (Documents-rooted)
	 *  folder picker. One button, routed by `status`. */
	onFinderView(): void
	/** Import a dragged-out file's bytes into the tldraw document. */
	onImport(shape: FileShape): void
}

const TlosUiContext = createContext<TlosUi | null>(null)
export const TlosUiProvider = TlosUiContext.Provider
export function useTlosUi(): TlosUi {
	const ctx = useContext(TlosUiContext)
	if (!ctx) throw new Error('useTlosUi must be used within TlosUiProvider')
	return ctx
}

/**
 * The import-vs-reference dialog, as a native tldraw dialog. Opened via
 * `useDialogs().addDialog` when a file is dragged out of its frame. "Import"
 * runs the App's import action then closes; closing any other way (Keep as
 * reference / X / esc / backdrop) just leaves the file where it was dropped.
 */
export function ImportDialog({ shape, onClose }: TLUiDialogProps & { shape: FileShape }) {
	const { onImport } = useTlosUi()
	return (
		<>
			<TldrawUiDialogHeader>
				<TldrawUiDialogTitle>Add “{shape.props.name}” to the canvas</TldrawUiDialogTitle>
				<TldrawUiDialogCloseButton />
			</TldrawUiDialogHeader>
			<TldrawUiDialogBody style={{ maxWidth: 340 }}>
				You dragged this file out of its folder. Import a copy into the tldraw document,
				or keep it as a live reference to the original on disk?
			</TldrawUiDialogBody>
			<TldrawUiDialogFooter className="tlui-dialog__footer__actions">
				<TldrawUiButton type="normal" onClick={onClose}>
					<TldrawUiButtonLabel>Keep as reference</TldrawUiButtonLabel>
				</TldrawUiButton>
				<TldrawUiButton
					type="primary"
					onClick={() => {
						onImport(shape)
						onClose()
					}}
				>
					<TldrawUiButtonLabel>Import into tldraw</TldrawUiButtonLabel>
				</TldrawUiButton>
			</TldrawUiDialogFooter>
		</>
	)
}

/** Hook the App uses (from inside Tldraw) to open the import dialog for a shape. */
export function useOpenImportDialog() {
	const { addDialog } = useDialogs()
	return useCallback(
		(shape: FileShape) =>
			addDialog({ component: (props) => <ImportDialog {...props} shape={shape} /> }),
		[addDialog],
	)
}

/**
 * The Finder-view control, injected as tldraw's SharePanel (top-right). It's a
 * native tldraw panel so it reads as app chrome, not a floating overlay. A
 * single **Finder View** button opens the Finder window: it reopens the
 * remembered folder when one is bound, re-grants a lapsed permission, or
 * (first run) opens the folder picker rooted at Documents. `onFinderView`
 * routes on `status`, so the button's job is the same regardless of state.
 */
export function BindPanel() {
	const { status, busy, onFinderView } = useTlosUi()
	if (status === 'loading') return null
	if (status === 'unsupported') {
		return (
			<div className="tlos-panel">
				<span className="tlos-panel__note">Finder View needs Chrome or Edge</span>
			</div>
		)
	}
	return (
		<div className="tlos-panel">
			<TldrawUiButton type="primary" disabled={busy} onClick={onFinderView}>
				<TldrawUiButtonLabel>Finder View</TldrawUiButtonLabel>
			</TldrawUiButton>
		</div>
	)
}
