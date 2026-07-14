import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tldraw, createShapeId, type Editor, type TLComponents } from 'tldraw'
import { isShapeId } from '@tldraw/tlschema'
import 'tldraw/tldraw.css'
import './App.css'
import {
	FileShapeUtil,
	ThumbProvider,
	setOpenHandler,
	isImageExt,
	type FileShape,
	type ThumbResolver,
} from './FileShapeUtil'
import {
	BrowserShapeUtil,
	BrowserServicesProvider,
	type BrowserEntry,
	type BrowserServices,
} from './BrowserShapeUtil'
import { BindPanel, TlosUiProvider, useOpenImportDialog, type TlosUi } from './ui'
import {
	fsAccessSupported,
	pickRootDirectory,
	loadRememberedRoot,
	ensurePermission,
	readDirectory,
	readFileBlob,
	getFileHandle,
	type DirHandle,
} from './fs'

const shapeUtils = [FileShapeUtil, BrowserShapeUtil]

// Page-space gap between a window and the next one placed to its right / below.
const FRAME_GAP = 48

/** tl-os — a spatial file workspace. Bind a local folder (Chrome/Edge), then
 *  browse it in movable, resizable macOS-Finder-style column-view windows drawn
 *  in a hand-drawn Perfect-Freehand style. Files can still be dragged out of a
 *  window onto the canvas. The canvas owns *layout*; disk owns *bytes*; they
 *  join by path. */
export default function App() {
	const editorRef = useRef<Editor | null>(null)
	const rootRef = useRef<DirHandle | null>(null)
	const [rootName, setRootName] = useState<string | null>(null)
	// 'unsupported' → this browser has no directory picker (Safari/Firefox).
	// 'none' → nothing bound. 'reconnect' → a remembered folder needs a click to
	// re-authorise. 'bound' → live and readable. Feature-detection is synchronous
	// so it seeds the initial state (no effect setState for the unsupported case).
	const [status, setStatus] = useState<'loading' | 'unsupported' | 'none' | 'reconnect' | 'bound'>(
		() => (fsAccessSupported() ? 'loading' : 'unsupported'),
	)
	const [busy, setBusy] = useState(false)
	// Set by DialogBridge (which lives inside Tldraw's UI context) so the mount
	// side-effect — which runs outside React — can open the native import dialog.
	const openImportDialogRef = useRef<((shape: FileShape) => void) | null>(null)

	// --- thumbnail resolver (path → object-URL for image files) -------------
	const resolveThumb = useCallback<ThumbResolver>(async (path, ext) => {
		const root = rootRef.current
		if (!root || !isImageExt(ext)) return null
		const blob = await readFileBlob(root, path)
		return blob ? URL.createObjectURL(blob) : null
	}, [])

	// --- open a file's bytes in a new tab -----------------------------------
	// The shared leaf-open path: read the file and hand it to a new browser tab
	// (images/pdf/text preview inline; others download). Used by both a file-icon
	// double-click and a browser-window file row.
	const openFilePath = useCallback(async (path: string) => {
		const root = rootRef.current
		if (!root) return
		const blob = await readFileBlob(root, path)
		if (!blob) return
		const url = URL.createObjectURL(blob)
		window.open(url, '_blank', 'noopener')
		// Give the tab time to grab the URL before revoking.
		setTimeout(() => URL.revokeObjectURL(url), 60_000)
	}, [])

	// --- open a file / navigate a folder on double-click --------------------
	const openShape = useCallback(async (shape: FileShape) => {
		const root = rootRef.current
		const editor = editorRef.current
		if (!root || !editor) return
		const { kind, path } = shape.props
		if (kind === 'directory') {
			// Open the folder as a column-view browser window, placed just to the
			// RIGHT of the frame this icon lives in (a file-shape's x/y are relative
			// to its parent frame, so anchor off the parent's *page* bounds, not the
			// icon's local coords). Fall back to the icon's own page point if it
			// somehow has no parent frame.
			const parentId = editor.getShape(shape.id)?.parentId
			// parentId may be a page id; only use it when it's a frame shape.
			const parentFrameId =
				parentId && isShapeId(parentId) && editor.getShape(parentId)?.type === 'frame'
					? parentId
					: null
			const parentBounds = editor.getShapePageBounds(parentFrameId ?? shape.id)
			const at = parentBounds
				? { x: parentBounds.maxX + FRAME_GAP, y: parentBounds.y }
				: { x: 0, y: 0 }
			openBrowser(editor, path, at.x, at.y, true)
			return
		}
		await openFilePath(path)
	}, [openFilePath])

	// --- import-vs-reference, for a file dragged out of its frame -----------
	// "Import": read the file's bytes and run tldraw's own file→asset→shape
	// pipeline at the icon's spot (image → image shape, etc.), then remove the
	// pointer icon — the content now lives in the tldraw document and survives
	// without the disk binding. "Keep as reference": leave the tlos-file pointer
	// where it was dropped (it stays bound to the original on disk).
	const importDrop = useCallback(async (shape: FileShape) => {
		const root = rootRef.current
		const editor = editorRef.current
		if (!root || !editor) return
		const handle = await getFileHandle(root, shape.props.path)
		if (!handle?.getFile) return
		const file = await handle.getFile()
		const bounds = editor.getShapePageBounds(shape.id)
		const point = bounds ? { x: bounds.x, y: bounds.y } : { x: shape.x, y: shape.y }
		await editor.putExternalContent({ type: 'files', files: [file], point })
		editor.deleteShapes([shape.id])
	}, [])

	// --- bind / reconnect ---------------------------------------------------
	const bindRoot = useCallback(async (root: DirHandle) => {
		rootRef.current = root
		setRootName(root.name)
		setStatus('bound')
		const editor = editorRef.current
		if (editor) openBrowser(editor, '', 0, 0, true)
	}, [])

	const handleGrant = useCallback(async () => {
		setBusy(true)
		try {
			const root = await pickRootDirectory()
			if (root) await bindRoot(root)
		} finally {
			setBusy(false)
		}
	}, [bindRoot])

	const handleReconnect = useCallback(async () => {
		const root = rootRef.current
		if (!root) return
		setBusy(true)
		try {
			const ok = await ensurePermission(root, { interactive: true })
			if (ok) await bindRoot(root)
		} finally {
			setBusy(false)
		}
	}, [bindRoot])

	// On mount: register the open handler, then (if supported) try to silently
	// re-bind a remembered folder. Support is already reflected in initial state.
	useEffect(() => {
		setOpenHandler((s) => void openShape(s))
		if (!fsAccessSupported()) return () => setOpenHandler(null)
		let cancelled = false
		void (async () => {
			const remembered = await loadRememberedRoot()
			if (cancelled) return
			if (!remembered) {
				setStatus('none')
				return
			}
			rootRef.current = remembered
			setRootName(remembered.name)
			// Permission can't be requested without a gesture — only query here.
			const granted = await ensurePermission(remembered, { interactive: false })
			if (cancelled) return
			if (granted) {
				setStatus('bound')
				if (editorRef.current) openBrowser(editorRef.current, '', 0, 0, true)
			} else {
				setStatus('reconnect')
			}
		})()
		return () => {
			cancelled = true
			setOpenHandler(null)
		}
	}, [openShape])

	const handleMount = useCallback((editor: Editor) => {
		editorRef.current = editor
		if (import.meta.env.DEV) {
			;(window as unknown as { __tlosEditor?: Editor }).__tlosEditor = editor
		}

		// Belt-and-braces: even with the thumbnail <img> non-draggable, refuse to
		// turn a blob:/file: URL into a bookmark shape (its url validator rejects
		// those protocols and throws, taking down the whole canvas). A registered
		// handler fully replaces the default and can't cleanly "fall through", and
		// re-dispatching via putExternalContent would recurse — so this swallows
		// blob:/file: and no-ops other URLs too. That's an acceptable tradeoff for
		// this file-manager (dropping a web URL to make a bookmark isn't a goal);
		// revisit if bookmark-from-URL is ever wanted.
		editor.registerExternalContentHandler('url', (content) => {
			if (/^(blob|file):/i.test(content.url)) return
		})

		// Detect a file-shape dragged OUT of its frame onto the page (user action:
		// parent goes from a frame to a page id). Prompt import-vs-reference once
		// per drop. Programmatic reparents (source !== 'user') are ignored, as is
		// the reverse (dropping back into a frame).
		editor.sideEffects.registerAfterChangeHandler('shape', (prev, next, source) => {
			if (source !== 'user' || next.type !== 'tlos-file') return
			if (prev.parentId === next.parentId) return
			const wasInFrame = isShapeId(prev.parentId) && editor.getShape(prev.parentId)?.type === 'frame'
			const nowOnPage = !isShapeId(next.parentId)
			if (wasInFrame && nowOnPage) openImportDialogRef.current?.(next as FileShape)
		})

		// If a root got bound before the editor mounted, dump it now.
		const root = rootRef.current
		if (root && status === 'bound') openBrowser(editor, '', 0, 0, true)
	}, [status])

	// Shared with the tldraw-mounted UI (BindPanel, import dialog) via context.
	const ui = useMemo<TlosUi>(
		() => ({
			status,
			rootName,
			busy,
			onGrant: () => void handleGrant(),
			onReconnect: () => void handleReconnect(),
			onImport: (shape) => void importDrop(shape),
		}),
		[status, rootName, busy, handleGrant, handleReconnect, importDrop],
	)

	// What the browser-shape needs from the App: list a directory, open a file
	// leaf. Both go through the disk layer here; the shape never imports it.
	const browserServices = useMemo<BrowserServices>(
		() => ({
			readDir: async (subPath) => {
				const root = rootRef.current
				if (!root) return []
				return readDirectory(root, subPath) as Promise<BrowserEntry[]>
			},
			openFile: (entry) => void openFilePath(entry.path),
		}),
		[openFilePath],
	)

	return (
		<div className="tlos-root">
			<TlosUiProvider value={ui}>
				<ThumbProvider value={resolveThumb}>
					<BrowserServicesProvider value={browserServices}>
						<Tldraw persistenceKey="tl-os" shapeUtils={shapeUtils} components={components} onMount={handleMount}>
							<DialogBridge openRef={openImportDialogRef} />
						</Tldraw>
					</BrowserServicesProvider>
				</ThumbProvider>
			</TlosUiProvider>
		</div>
	)
}

// The bind control lives in tldraw's top-right SharePanel slot, so it reads as
// native app chrome rather than a floating overlay.
const components: TLComponents = {
	SharePanel: BindPanel,
}

/** Renders nothing; bridges the import-dialog opener (a hook, so it must run
 *  inside Tldraw's UI context) out to a ref the mount side-effect can call. */
function DialogBridge({ openRef }: { openRef: React.RefObject<((s: FileShape) => void) | null> }) {
	const open = useOpenImportDialog()
	useEffect(() => {
		openRef.current = open
		return () => {
			openRef.current = null
		}
	}, [open, openRef])
	return null
}

// Default size of a freshly-opened browser window (matches the shape util's
// getDefaultProps: three columns wide, a comfortable browsing height).
const BROWSER_W = 176 * 3 + 20
const BROWSER_H = 320

/**
 * Open the folder at `subPath` as a column-view browser window at page (fx, fy).
 * Reconciles by `meta.tlosPath`: re-opening the same folder replaces the old
 * window (and its scroll/selection state) rather than piling up duplicates —
 * the same rule the icon-grid used, so re-reads stay idempotent. The window's
 * `selection` starts empty (just the root column); the disk is read lazily by
 * each column inside the shape via BrowserServices.
 */
function openBrowser(
	editor: Editor,
	subPath: string,
	fx: number,
	fy: number,
	// Pan the camera to centre the new window (folder-open / bind); the mount
	// re-dump leaves the camera where it is is handled by the caller passing false.
	centerCamera = false,
): void {
	// Replace any existing window for this folder.
	const existing = editor
		.getCurrentPageShapes()
		.find((s) => s.type === 'tlos-browser' && (s.meta as { tlosPath?: string }).tlosPath === subPath)
	if (existing) editor.deleteShapes([existing.id])

	// Stack below any window it would overlap, so a second open lands clear.
	const y = avoidOverlap(editor, fx, fy, BROWSER_W, BROWSER_H)

	editor.createShape({
		id: createShapeId(),
		type: 'tlos-browser',
		x: fx,
		y,
		props: { w: BROWSER_W, h: BROWSER_H, rootPath: subPath, selection: [] },
		meta: { tlosPath: subPath },
	})

	if (centerCamera) {
		editor.centerOnPoint(
			{ x: fx + BROWSER_W / 2, y: y + BROWSER_H / 2 },
			{ animation: { duration: 300 } },
		)
	}
}

/**
 * Given a target rect at (x, y, w, h) in page space, return a y pushed down just
 * far enough to clear every existing browser window it would overlap. x stays
 * fixed (new windows open in a rightward column, stacking downward). Iterates
 * because clearing one window can reveal an overlap with the next below it.
 */
function avoidOverlap(editor: Editor, x: number, y: number, w: number, h: number): number {
	const boxes = editor
		.getCurrentPageShapes()
		.filter((s) => s.type === 'tlos-browser' || s.type === 'frame')
		.map((s) => editor.getShapePageBounds(s.id))
		.filter((b): b is NonNullable<typeof b> => b != null)
	let moved = true
	let guard = 0
	while (moved && guard++ < 100) {
		moved = false
		for (const b of boxes) {
			const overlaps = x < b.maxX && x + w > b.x && y < b.maxY && y + h > b.y
			if (overlaps) {
				y = b.maxY + FRAME_GAP
				moved = true
			}
		}
	}
	return y
}
