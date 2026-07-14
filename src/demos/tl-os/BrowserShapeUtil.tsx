/**
 * tl-os — the column-view browser shape.
 *
 * A movable, resizable macOS-Finder-style **column view** as a native tldraw
 * shape (`tlos-browser`). Each open folder is one of these windows; you can have
 * several on the canvas at once, drag and resize them like any shape — the
 * canvas stays authoritative for *layout*, the disk for *bytes/structure* (the
 * one architectural rule; see CLAUDE.md).
 *
 * A browser is a *pointer*, like `tlos-file`: it stores only `rootPath` (the
 * root-relative folder it opens) and `selection` (the path picked in each
 * column, which drives what the next column shows). No bytes or handles live in
 * props — directories are read on demand through a `BrowserServices` context the
 * App wires up, so this file never imports the disk layer or the root handle.
 *
 * The chrome is drawn with Perfect Freehand (see freehand.ts): a rough window
 * outline, wobbly column dividers, hand-drawn selection boxes, and freehand
 * disclosure chevrons — so it reads as "a Finder sketched on the tldraw canvas,"
 * matching the hand-drawn file/folder glyphs.
 */
/* eslint-disable react-refresh/only-export-components -- a shape-util module
   necessarily exports the util class plus its context provider / helpers; same
   rationale as FileShapeUtil.tsx. Fast refresh falls back to a reload here. */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
	BaseBoxShapeUtil,
	HTMLContainer,
	resizeBox,
	stopEventPropagation,
	T,
	useEditor,
	type RecordProps,
	type TLBaseShape,
	type TLResizeInfo,
} from 'tldraw'
import { isImageExt, useThumbResolver } from './FileShapeUtil'
import { chevron, line, roughRect, strokePath, poly } from './freehand'

// A directory entry the browser renders. Mirrors fs.ts's DirEntry, redeclared
// here so this module doesn't import the disk layer (kept resolver-only).
export interface BrowserEntry {
	path: string
	name: string
	kind: 'file' | 'directory'
	ext: string
}

/** A picked entry in the column chain. Carries `kind`/`ext` (not just the path)
 *  so the view knows, without a disk read, whether the next column is another
 *  directory listing or a file preview pane. */
export type Picked = { path: string; kind: 'file' | 'directory'; ext: string }

export type BrowserProps = {
	w: number
	h: number
	/** Root-relative POSIX path of the folder this window opens ('' = root). */
	rootPath: string
	/** The entry selected in each column: selection[i] drives column i+1. A
	 *  directory continues the chain (its listing); a file is a leaf whose next
	 *  column is a preview pane. */
	selection: Picked[]
}
export type BrowserShape = TLBaseShape<'tlos-browser', BrowserProps>

declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'tlos-browser': BrowserProps
	}
}

/**
 * Everything the browser shape needs from the App, without importing the disk
 * layer: read a directory's entries on demand, and open a file leaf. The App
 * wires `readDir` to fs.ts's `readDirectory` and `openFile` to its own
 * open-a-file path (a new tab), so the shape stays a pure pointer.
 */
export interface BrowserServices {
	/** List one directory (non-recursive), keyed by root-relative `subPath`
	 *  ('' = root). */
	readDir(subPath: string): Promise<BrowserEntry[]>
	/** Open a file leaf (double-click). Folders navigate in-place, not here. */
	openFile(entry: BrowserEntry): void
}
const ServicesContext = createContext<BrowserServices | null>(null)
export const BrowserServicesProvider = ServicesContext.Provider

// --- Layout constants ------------------------------------------------------
const COL_W = 176 // one column's width
const PREVIEW_W = 220 // the trailing file-preview pane (wider than a listing)
const ROW_H = 26 // one file/folder row's height
const HEADER_H = 30 // the window title bar
const PAD = 10 // inner padding inside the window frame
const ROW_PAD_X = 8 // left/right padding inside a column row
const GLYPH = 15 // little inline file/folder glyph size in a row

// Family tints match FileShapeUtil's palette (tldraw draw-palette hexes).
const TINT_FOLDER = '#4465e9'
const TINT_IMAGE = '#4ba1f1'
const TINT_DEFAULT = '#9fa8b2'

/**
 * The columns to render, left to right. Always a directory column for the root,
 * then one per selection: a *directory* pick contributes another directory
 * column (its listing); a *file* pick contributes a preview column (macOS shows
 * the file's preview in the trailing pane). A file is always a leaf, so it's the
 * last column.
 */
type ColumnSpec =
	| { kind: 'dir'; path: string }
	| { kind: 'preview'; entry: Picked }

function columnSpecs(selection: Picked[]): ColumnSpec[] {
	const cols: ColumnSpec[] = [{ kind: 'dir', path: '' }]
	for (const pick of selection) {
		if (pick.kind === 'directory') cols.push({ kind: 'dir', path: pick.path })
		else cols.push({ kind: 'preview', entry: pick })
	}
	return cols
}

// ---------------------------------------------------------------------------

export class BrowserShapeUtil extends BaseBoxShapeUtil<BrowserShape> {
	static override type = 'tlos-browser' as const
	static override props: RecordProps<BrowserShape> = {
		w: T.number,
		h: T.number,
		rootPath: T.string,
		selection: T.arrayOf(
			T.object({
				path: T.string,
				kind: T.literalEnum('file', 'directory'),
				ext: T.string,
			}),
		),
	}

	override getDefaultProps(): BrowserProps {
		return { w: COL_W * 3 + PAD * 2, h: 320, rootPath: '', selection: [] }
	}

	override canResize() {
		return true
	}

	override onResize(shape: BrowserShape, info: TLResizeInfo<BrowserShape>) {
		return resizeBox(shape, info)
	}

	override component(shape: BrowserShape) {
		return <BrowserWindow shape={shape} />
	}

	override getIndicatorPath(shape: BrowserShape): Path2D {
		const { w, h } = shape.props
		const p = new Path2D()
		p.roundRect(0, 0, w, h, 10)
		return p
	}
}

/** The window: hand-drawn frame + a title bar + a horizontally-scrolling strip
 *  of columns. Resizing the shape changes how many columns/rows are visible. */
function BrowserWindow({ shape }: { shape: BrowserShape }) {
	const { w, h, rootPath, selection } = shape.props
	const cols = columnSpecs(selection)
	const bodyH = h - HEADER_H

	// The freehand window outline + title-bar rule, sized to the live w/h. A few
	// short strokes; recomputed per render so the wobble tracks a resize.
	const frame = useMemo(() => {
		return {
			outline: roughRect(2, 2, w - 4, h - 4, 10, 2.2),
			// A visibly wavy underline under the title bar.
			titleRule: line(6, HEADER_H, w - 6, HEADER_H, 1.6, 2.4),
		}
	}, [w, h])

	const label = rootPath ? rootPath.split('/').pop()! : 'Files'

	// Keep the newest column in view: when the chain grows deeper, scroll the
	// strip fully right (macOS reveals the just-opened column).
	const stripRef = useRef<HTMLDivElement | null>(null)
	useEffect(() => {
		const el = stripRef.current
		if (el) el.scrollLeft = el.scrollWidth
	}, [cols.length])

	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			{/* The panel surface (interior fill). The freehand ink ring is drawn on
			    top of it; a subtle border-radius echoes the rounded window. */}
			<div
				style={{
					position: 'absolute',
					inset: 4,
					borderRadius: 10,
					background: 'var(--tl-color-panel)',
					boxShadow: 'var(--tl-shadow-2, 0 1px 4px rgba(0,0,0,0.2))',
				}}
			/>
			{/* Hand-drawn window outline + title-bar rule, over the surface but
			    behind the interactive rows. `overflow:visible` keeps the wobble. */}
			<svg
				width={w}
				height={h}
				viewBox={`0 0 ${w} ${h}`}
				style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
			>
				<path d={frame.outline} fill="var(--tl-color-text)" opacity={0.85} stroke="none" />
				<path d={frame.titleRule} fill="var(--tl-color-text)" opacity={0.5} stroke="none" />
			</svg>

			{/* Title bar. */}
			<div
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					right: 0,
					height: HEADER_H,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontFamily: 'var(--tl-font-sans)',
					fontSize: 12,
					fontWeight: 600,
					color: 'var(--tl-color-text)',
					userSelect: 'none',
				}}
			>
				{label}
			</div>

			{/* The columns strip: scrolls horizontally, each column scrolls its own
			    rows vertically. Wheel events are swallowed so scrolling a column
			    doesn't pan/zoom the canvas underneath. */}
			<div
				ref={stripRef}
				onWheel={stopEventPropagation}
				style={{
					position: 'absolute',
					top: HEADER_H,
					left: PAD,
					width: w - PAD * 2,
					height: bodyH - PAD,
					display: 'flex',
					overflowX: 'auto',
					overflowY: 'hidden',
				}}
			>
				{cols.map((col, i) =>
					col.kind === 'preview' ? (
						<PreviewColumn
							key={`${i}:preview:${col.entry.path}`}
							entry={col.entry}
							height={bodyH - PAD}
						/>
					) : (
						<Column
							key={`${i}:${col.path}`}
							shape={shape}
							colPath={col.path}
							colIndex={i}
							height={bodyH - PAD}
							selectedInThisColumn={selection[i]?.path ?? null}
							isLastDivider={i === cols.length - 1}
						/>
					),
				)}
			</div>
		</HTMLContainer>
	)
}

/** One column: the sorted entries of `colPath`, each row selectable. Selecting a
 *  folder extends `selection` (opening the next column); selecting a file trims
 *  the chain to a leaf; double-clicking a file opens it via the shared handler. */
function Column({
	shape,
	colPath,
	colIndex,
	height,
	selectedInThisColumn,
	isLastDivider,
}: {
	shape: BrowserShape
	colPath: string
	colIndex: number
	height: number
	selectedInThisColumn: string | null
	isLastDivider: boolean
}) {
	const editor = useEditor()
	const services = useContext(ServicesContext)
	const [entries, setEntries] = useState<BrowserEntry[] | null>(null)

	useEffect(() => {
		if (!services) return
		let live = true
		services.readDir(colPath).then((e) => {
			if (live) setEntries(e)
		})
		return () => {
			live = false
		}
	}, [services, colPath])

	// A wobbly vertical divider on the column's right edge (skip the last one —
	// the window frame already closes the right side). A bigger amp on the taller
	// vertical rule keeps its waver proportional to the header underline's.
	const divider = useMemo(
		() => (isLastDivider ? null : line(COL_W - 1, 4, COL_W - 1, height - 4, 1.4, 3)),
		[height, isLastDivider],
	)

	function select(entry: BrowserEntry) {
		// Keep selections for columns to the LEFT of this one; replace the rest
		// with this pick (choosing a new item collapses any deeper columns).
		const next: Picked[] = shape.props.selection.slice(0, colIndex)
		next.push({ path: entry.path, kind: entry.kind, ext: entry.ext })
		editor.updateShape<BrowserShape>({
			id: shape.id,
			type: 'tlos-browser',
			props: { selection: next },
		})
	}

	return (
		<div
			style={{
				position: 'relative',
				flex: `0 0 ${COL_W}px`,
				width: COL_W,
				height,
				overflowY: 'auto',
				overflowX: 'hidden',
			}}
		>
			{divider && (
				<svg
					width={COL_W}
					height={height}
					viewBox={`0 0 ${COL_W} ${height}`}
					style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
				>
					<path d={divider} fill="var(--tl-color-text)" opacity={0.35} stroke="none" />
				</svg>
			)}
			{entries === null ? (
				<Placeholder text="…" />
			) : entries.length === 0 ? (
				<Placeholder text="empty" />
			) : (
				entries.map((entry) => (
					<Row
						key={entry.path}
						entry={entry}
						selected={entry.path === selectedInThisColumn}
						onSelect={() => select(entry)}
						onOpen={() => services?.openFile(entry)}
					/>
				))
			)}
		</div>
	)
}

/**
 * The trailing preview pane, shown when the current leaf selection is a *file*
 * (macOS's column view previews the selected file here). Images render as a
 * thumbnail via the shared thumb resolver; everything else gets a file-info card
 * (big hand-drawn glyph, name, extension badge, path). Wider than a listing
 * column so a preview has room to breathe.
 */
function PreviewColumn({ entry, height }: { entry: Picked; height: number }) {
	const resolveThumb = useThumbResolver()
	const [url, setUrl] = useState<string | null>(null)
	const isImage = isImageExt(entry.ext)

	useEffect(() => {
		if (!resolveThumb || !isImage) return
		let revoked = false
		let created: string | null = null
		resolveThumb(entry.path, entry.ext).then((u) => {
			if (revoked) {
				if (u) URL.revokeObjectURL(u)
				return
			}
			created = u
			setUrl(u)
		})
		return () => {
			revoked = true
			if (created) URL.revokeObjectURL(created)
			setUrl(null)
		}
	}, [resolveThumb, entry.path, entry.ext, isImage])

	const name = entry.path.split('/').pop() ?? entry.path
	const tint = isImage ? TINT_IMAGE : TINT_DEFAULT

	return (
		<div
			style={{
				position: 'relative',
				flex: `0 0 ${PREVIEW_W}px`,
				width: PREVIEW_W,
				height,
				padding: 14,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				gap: 10,
				textAlign: 'center',
				overflow: 'hidden',
			}}
		>
			{isImage && url ? (
				<FreehandImage src={url} alt={name} />
			) : (
				<PreviewGlyph tint={tint} />
			)}
			<div
				style={{
					// tldraw's native handwriting ("Draw") font, matching the
					// hand-drawn chrome.
					fontFamily: 'var(--tl-font-draw)',
					fontSize: 15,
					fontWeight: 500,
					color: 'var(--tl-color-text)',
					wordBreak: 'break-word',
					lineHeight: 1.25,
				}}
			>
				{name}
			</div>
			{entry.ext && (
				<span
					style={{
						fontFamily: 'var(--tl-font-draw)',
						fontSize: 11,
						fontWeight: 500,
						letterSpacing: 0.4,
						textTransform: 'uppercase',
						color: '#fff',
						background: tint,
						borderRadius: 4,
						padding: '2px 6px',
					}}
				>
					{entry.ext}
				</span>
			)}
			<div
				style={{
					fontFamily: 'var(--tl-font-sans)',
					fontSize: 10,
					color: 'var(--tl-color-text-3, var(--tl-color-text))',
					opacity: 0.6,
					wordBreak: 'break-all',
					maxWidth: '100%',
				}}
			>
				{entry.path}
			</div>
		</div>
	)
}

/**
 * An image preview wrapped in a hand-drawn Perfect-Freehand border (instead of a
 * drop shadow). The image's rendered size isn't known until it loads and depends
 * on its aspect ratio, so we measure the shrink-wrapped box with a ResizeObserver
 * and stroke a `roughRect` sized to it — the wobbly ink ring hugs the picture's
 * actual edges. `overflow:visible` lets the wobble sit just outside the frame.
 */
function FreehandImage({ src, alt }: { src: string; alt: string }) {
	const boxRef = useRef<HTMLSpanElement | null>(null)
	const [size, setSize] = useState<{ w: number; h: number } | null>(null)

	useEffect(() => {
		const el = boxRef.current
		if (!el || typeof ResizeObserver === 'undefined') return
		const ro = new ResizeObserver(() => {
			setSize({ w: el.offsetWidth, h: el.offsetHeight })
		})
		ro.observe(el)
		return () => ro.disconnect()
	}, [])

	// Trace the border a hair outside the image box so the ink frames it.
	const border = useMemo(() => {
		if (!size || size.w < 2 || size.h < 2) return null
		return roughRect(-3, -3, size.w + 6, size.h + 6, 8, 2)
	}, [size])

	return (
		<span
			ref={boxRef}
			style={{
				position: 'relative',
				display: 'inline-block',
				maxWidth: '100%',
				maxHeight: '55%',
				lineHeight: 0,
			}}
		>
			<img
				src={src}
				alt={alt}
				// A blob: <img> is natively draggable and, if dragged onto the canvas,
				// crashes tldraw's bookmark handler (see the demo CLAUDE.md). Disable
				// native drag + pointer events so the drag hits the shape.
				draggable={false}
				style={{
					display: 'block',
					maxWidth: '100%',
					maxHeight: '100%',
					objectFit: 'contain',
					borderRadius: 5,
					pointerEvents: 'none',
					userSelect: 'none',
				}}
			/>
			{border && (
				<svg
					width={size!.w}
					height={size!.h}
					viewBox={`0 0 ${size!.w} ${size!.h}`}
					style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
				>
					<path d={border} fill="var(--tl-color-text)" opacity={0.85} stroke="none" />
				</svg>
			)}
		</span>
	)
}

/** A large hand-drawn file glyph for the preview pane (non-image files). */
function PreviewGlyph({ tint }: { tint: string }) {
	return (
		<svg
			viewBox="0 0 100 100"
			width={64}
			height={64}
			style={{ display: 'block', overflow: 'visible' }}
		>
			<path d={ROW_FILE_FILL} fill="var(--tl-color-panel)" stroke="none" />
			<path d={ROW_FILE} fill={tint} stroke="none" />
		</svg>
	)
}

/** One row: a hand-drawn glyph, the name, and — for folders — a freehand
 *  disclosure chevron. When selected, a rough freehand box is drawn behind it. */
function Row({
	entry,
	selected,
	onSelect,
	onOpen,
}: {
	entry: BrowserEntry
	selected: boolean
	onSelect: () => void
	onOpen: () => void
}) {
	const isDir = entry.kind === 'directory'
	const tint = isDir ? TINT_FOLDER : isImageExt(entry.ext) ? TINT_IMAGE : TINT_DEFAULT

	// Selection box + chevron are drawn freehand, sized to the row. Cheap; the
	// row count is small (one visible column's worth at a time).
	const sel = useMemo(
		() => (selected ? roughRect(2, 2, COL_W - 4, ROW_H - 4, 6, 1.6) : null),
		[selected],
	)
	const chev = useMemo(
		() => (isDir ? chevron(COL_W - 12, ROW_H / 2, 4, 1.4) : null),
		[isDir],
	)

	return (
		<div
			onPointerDown={(e) => {
				// Don't let the click start a canvas box-select / shape drag.
				stopEventPropagation(e)
				onSelect()
			}}
			onDoubleClick={(e) => {
				stopEventPropagation(e)
				// Open a file leaf (new tab). Folders open by single-click into the
				// next column, so a double-click on a folder is a harmless no-op.
				if (entry.kind === 'file') onOpen()
			}}
			style={{
				position: 'relative',
				height: ROW_H,
				display: 'flex',
				alignItems: 'center',
				gap: 6,
				padding: `0 ${ROW_PAD_X}px`,
				cursor: 'default',
				userSelect: 'none',
			}}
		>
			{/* Solid selection fill (so white text reads), with the freehand ring
			    drawn on top as a hand-drawn edge. Both sit behind the content. */}
			{selected && (
				<div
					style={{
						position: 'absolute',
						inset: '2px',
						borderRadius: 6,
						background: TINT_FOLDER,
					}}
				/>
			)}
			{(sel || chev) && (
				<svg
					width={COL_W}
					height={ROW_H}
					viewBox={`0 0 ${COL_W} ${ROW_H}`}
					style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
				>
					{sel && <path d={sel} fill="#fff" opacity={0.5} stroke="none" />}
					{chev && (
						<path
							d={chev}
							fill={selected ? '#fff' : 'var(--tl-color-text)'}
							opacity={selected ? 0.9 : 0.45}
							stroke="none"
						/>
					)}
				</svg>
			)}
			<RowGlyph kind={entry.kind} tint={selected ? '#fff' : tint} />
			<span
				style={{
					position: 'relative',
					flex: 1,
					minWidth: 0,
					fontFamily: 'var(--tl-font-sans)',
					fontSize: 12,
					lineHeight: 1.1,
					color: selected ? '#fff' : 'var(--tl-color-text)',
					whiteSpace: 'nowrap',
					overflow: 'hidden',
					textOverflow: 'ellipsis',
				}}
			>
				{entry.name}
			</span>
		</div>
	)
}

// A small inline file/folder glyph for a row, drawn freehand at GLYPH px in a
// 0–100 art box (same style as FileShapeUtil's big glyphs, minimised for a row).
const ROW_FOLDER = strokePath(
	poly([
		[14, 34],
		[14, 26],
		[42, 26],
		[50, 34],
		[86, 34],
		[86, 78],
		[14, 78],
		[14, 34],
	]),
	5,
)
const ROW_FILE_OUTLINE = poly([
	[28, 16],
	[62, 16],
	[78, 32],
	[78, 84],
	[28, 84],
	[28, 16],
])
const ROW_FILE = strokePath(ROW_FILE_OUTLINE, 5)
const ROW_FILE_FILL =
	'M ' + ROW_FILE_OUTLINE.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ') + ' Z'
const ROW_FOLDER_FILL_PATH =
	'M 14 34 L 14 26 L 42 26 L 50 34 L 86 34 L 86 78 L 14 78 Z'

function RowGlyph({ kind, tint }: { kind: 'file' | 'directory'; tint: string }) {
	return (
		<svg
			viewBox="0 0 100 100"
			width={GLYPH}
			height={GLYPH}
			style={{ position: 'relative', display: 'block', flex: '0 0 auto', overflow: 'visible' }}
		>
			{kind === 'directory' ? (
				<>
					<path d={ROW_FOLDER_FILL_PATH} fill={tint} opacity={0.22} stroke="none" />
					<path d={ROW_FOLDER} fill={tint} stroke="none" />
				</>
			) : (
				<>
					<path d={ROW_FILE_FILL} fill="var(--tl-color-panel)" stroke="none" />
					<path d={ROW_FILE} fill={tint} stroke="none" />
				</>
			)}
		</svg>
	)
}

function Placeholder({ text }: { text: string }) {
	return (
		<div
			style={{
				padding: '6px 10px',
				fontFamily: 'var(--tl-font-sans)',
				fontSize: 11,
				color: 'var(--tl-color-text-3, var(--tl-color-text))',
				opacity: 0.6,
				userSelect: 'none',
			}}
		>
			{text}
		</div>
	)
}
