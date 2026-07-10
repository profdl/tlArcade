/**
 * tl-os — the file/folder shape.
 *
 * One ShapeUtil for both files and directories (`props.kind` selects). A
 * file-shape is a *pointer*: `path` is the root-relative join key back to disk;
 * position/notes/etc. live here in the tldraw store. No bytes live in props —
 * the image thumbnail is loaded lazily by the component from a handle resolver
 * passed in via context (so the store stays serialisable and small).
 *
 * v5 registers a custom shape by augmenting TLGlobalShapePropsMap (folds
 * `'tlos-file'` into the TLShape union so typed editor APIs accept it) — same
 * pattern as busytown's SpriteShapeUtil.
 */
/* eslint-disable react-refresh/only-export-components -- a shape-util module
   necessarily exports the util class plus its context provider / helper values
   alongside components; splitting them across files would fragment one shape's
   definition for no benefit. Fast-refresh of this file falls back to a full
   reload, which is fine. */
import { createContext, useContext, useEffect, useState } from 'react'
import {
	BaseBoxShapeUtil,
	HTMLContainer,
	T,
	type RecordProps,
	type TLBaseShape,
} from 'tldraw'
import { poly, strokePath } from './freehand'

export type FileProps = {
	w: number
	h: number
	/** Root-relative POSIX path — the join key back to disk. */
	path: string
	name: string
	kind: 'file' | 'directory'
	/** Lowercased extension without the dot ('' for dirs / no-ext files). */
	ext: string
}
export type FileShape = TLBaseShape<'tlos-file', FileProps>

declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'tlos-file': FileProps
	}
}

/**
 * A resolver the App wires up so shapes can turn their `path` into a thumbnail
 * object-URL on demand, without the shape util importing the disk layer or the
 * root handle directly. Returns null when there's no image (or no binding).
 */
export type ThumbResolver = (path: string, ext: string) => Promise<string | null>
const ThumbContext = createContext<ThumbResolver | null>(null)
export const ThumbProvider = ThumbContext.Provider

/**
 * Double-click "open" side-effect. `onDoubleClick` runs in the util (outside
 * React), so instead of a context we keep a module-level callback the App sets
 * on mount. Opening a file/folder is a side-effect, not a shape mutation, so the
 * handler returns void and we invoke this rather than returning a partial.
 */
let openHandler: ((shape: FileShape) => void) | null = null
export function setOpenHandler(fn: ((shape: FileShape) => void) | null) {
	openHandler = fn
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'])
export const isImageExt = (ext: string) => IMAGE_EXTS.has(ext)

/** Coarse file-family for the glyph/tint, from the extension. */
function family(ext: string): 'image' | 'doc' | 'code' | 'media' | 'archive' | 'file' {
	if (IMAGE_EXTS.has(ext)) return 'image'
	if (['md', 'txt', 'pdf', 'doc', 'docx', 'rtf', 'pages'].includes(ext)) return 'doc'
	if (['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'py', 'rs', 'go', 'sh'].includes(ext))
		return 'code'
	if (['mp4', 'mov', 'mp3', 'wav', 'aiff', 'webm', 'm4a'].includes(ext)) return 'media'
	if (['zip', 'tar', 'gz', 'dmg', '7z', 'rar'].includes(ext)) return 'archive'
	return 'file'
}

// Family tints are drawn from tldraw's own draw-color palette so the icons sit
// naturally in the tldraw palette (same hexes the SDK ships for light-blue /
// green / violet / orange / grey). The glyph's *surface* and the filename use
// tldraw theme CSS vars instead, so both flip correctly in dark mode.
const FAMILY_TINT: Record<string, string> = {
	image: '#4ba1f1', // light-blue
	doc: '#9fa8b2', // grey
	code: '#099268', // green
	media: '#ae3ec9', // violet
	archive: '#e16919', // orange
	file: '#9fa8b2', // grey
}

// Sheet-with-a-folded-corner, drawn hand-drawn to match the folder: a freehand
// outline (family-tint ink) over a panel-coloured fill, plus a rough fold line.
// The dog-eared corner is the cut from the top edge down to the fold. Coords in
// the 0–100 box.
const FILE_OUTLINE = poly([
	[26, 14],
	[60, 14],
	[76, 30],
	[76, 86],
	[26, 86],
	[26, 14],
])
const FILE_FOLD = poly([
	[60, 14],
	[60, 30],
	[76, 30],
])
const FILE_INK_PATH = strokePath(FILE_OUTLINE, 3)
const FILE_FOLD_PATH = strokePath(FILE_FOLD, 3)
const FILE_FILL_PATH =
	'M ' + FILE_OUTLINE.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ') + ' Z'

/** The little sheet-with-a-folded-corner file glyph, tinted per family. The
 *  sheet fill follows the tldraw panel colour so it reads on either theme. */
function FileGlyph({ tint }: { tint: string }) {
	return (
		<svg viewBox="0 0 100 100" width="52" height="52" style={{ display: 'block', overflow: 'visible' }}>
			<path d={FILE_FILL_PATH} fill="var(--tl-color-panel)" stroke="none" />
			<path d={FILE_INK_PATH} fill={tint} stroke="none" />
			<path d={FILE_FOLD_PATH} fill={tint} stroke="none" />
		</svg>
	)
}

// A folder glyph drawn hand-drawn, tldraw-style: the outline is a perfect-
// freehand stroke (filled outline, even nib) rather than a crisp vector path, so
// it reads as "drawn on the tldraw canvas" like a native Draw shape. Ink is
// tldraw blue with a translucent blue body fill (works on either theme; a solid
// light-blue glared in dark mode). Coords live in a 0–100 box.
const FOLDER_BLUE = '#4465e9' // tldraw 'blue'
const FOLDER_FILL = 'rgba(68, 101, 233, 0.24)'
// Folder outline corners: back-tab up the left, across the top of the tab, a
// small step down to the body's top edge, along the top, down the right, and
// back along the bottom — closed by repeating the first corner.
const FOLDER_OUTLINE = poly([
	[14, 32],
	[14, 24],
	[40, 24],
	[47, 31],
	[86, 31],
	[86, 76],
	[14, 76],
	[14, 32],
])
const FOLDER_INK_PATH = strokePath(FOLDER_OUTLINE, 3.2)
// Centre-line closed path for the translucent body fill (just the polygon).
const FOLDER_FILL_PATH =
	'M ' + FOLDER_OUTLINE.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ') + ' Z'

function FolderGlyph() {
	return (
		<svg viewBox="0 0 100 100" width="58" height="58" style={{ display: 'block', overflow: 'visible' }}>
			<path d={FOLDER_FILL_PATH} fill={FOLDER_FILL} stroke="none" />
			<path d={FOLDER_INK_PATH} fill={FOLDER_BLUE} stroke="none" />
		</svg>
	)
}

/** Loads and shows an image thumbnail for an image file; falls back to the file
 *  glyph while loading or if the file can't be read. Revokes the object URL on
 *  unmount so we don't leak blobs. */
function Thumbnail({ path, ext }: { path: string; ext: string }) {
	const resolve = useContext(ThumbContext)
	const [url, setUrl] = useState<string | null>(null)
	useEffect(() => {
		if (!resolve) return
		let revoked = false
		let created: string | null = null
		resolve(path, ext).then((u) => {
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
		}
	}, [resolve, path, ext])

	if (url) {
		return (
			<img
				src={url}
				alt={path}
				// A blob: <img> is natively draggable by the browser. If it drags,
				// the canvas receives a `url` drop of the blob: URL and tldraw's
				// default handler tries to make a bookmark shape from it — whose
				// url validator rejects the blob: protocol and crashes the app.
				// Disable native drag and let the drag hit the tldraw shape instead.
				draggable={false}
				style={{
					maxWidth: '80%',
					maxHeight: '60%',
					objectFit: 'contain',
					borderRadius: 4,
					pointerEvents: 'none',
					userSelect: 'none',
				}}
			/>
		)
	}
	return <FileGlyph tint={FAMILY_TINT.image} />
}

export class FileShapeUtil extends BaseBoxShapeUtil<FileShape> {
	static override type = 'tlos-file' as const
	static override props: RecordProps<FileShape> = {
		w: T.number,
		h: T.number,
		path: T.string,
		name: T.string,
		kind: T.literalEnum('file', 'directory'),
		ext: T.string,
	}

	override getDefaultProps(): FileProps {
		return { w: 96, h: 104, path: '', name: 'untitled', kind: 'file', ext: '' }
	}

	// Pointers, not resizable content: keep them a fixed icon size.
	override canResize() {
		return false
	}

	override component(shape: FileShape) {
		const { name, kind, ext, path, w, h } = shape.props
		const fam = family(ext)
		return (
			<HTMLContainer
				className="tlos-file"
				style={{
					width: w,
					height: h,
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'flex-start',
					gap: 4,
					padding: 4,
					borderRadius: 6,
					pointerEvents: 'all',
					userSelect: 'none',
				}}
			>
				<div
					style={{
						position: 'relative',
						height: 60,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: '100%',
					}}
				>
					{kind === 'directory' ? (
						<FolderGlyph />
					) : isImageExt(ext) ? (
						<Thumbnail path={path} ext={ext} />
					) : (
						<FileGlyph tint={FAMILY_TINT[fam]} />
					)}
					{kind === 'file' && ext && !isImageExt(ext) ? (
						<span
							style={{
								position: 'absolute',
								bottom: 6,
								fontSize: 8,
								fontWeight: 700,
								letterSpacing: 0.4,
								color: '#fff',
								background: FAMILY_TINT[fam],
								borderRadius: 3,
								padding: '1px 4px',
								textTransform: 'uppercase',
							}}
						>
							{ext}
						</span>
					) : null}
				</div>
				<div
					style={{
						fontSize: 11,
						lineHeight: 1.2,
						textAlign: 'center',
						color: 'var(--tl-color-text)',
						fontFamily: 'var(--tl-font-sans)',
						maxWidth: '100%',
						// Two-line clamp so long names don't overflow the icon.
						display: '-webkit-box',
						WebkitLineClamp: 2,
						WebkitBoxOrient: 'vertical',
						overflow: 'hidden',
						wordBreak: 'break-word',
					}}
				>
					{name}
				</div>
			</HTMLContainer>
		)
	}

	override getIndicatorPath(shape: FileShape): Path2D {
		const { w, h } = shape.props
		const p = new Path2D()
		p.roundRect(0, 0, w, h, 6)
		return p
	}

	// Double-click opens the file (or navigates into a folder). It's a side
	// effect, not a shape edit, so fire the App's handler and return void.
	override onDoubleClick(shape: FileShape) {
		openHandler?.(shape)
	}
}
