/**
 * tl-os — the disk-binding layer.
 *
 * The canvas is authoritative for *layout* (where a file-shape sits, its notes,
 * colour); the disk is authoritative for *bytes and directory structure*. This
 * module is the only place the two meet: it grants a directory, remembers the
 * handle across sessions, and reads entries. Everything upstream deals in plain
 * `DirEntry` pointers keyed by `path` — no handle leaks into the shape store
 * (handles aren't serialisable and are machine-/origin-local, which is exactly
 * why the future multiplayer board syncs the *index*, not the handles).
 *
 * Browser reality: `showDirectoryPicker` is Chrome/Edge/Opera only — Safari and
 * Firefox ship only the Origin-Private FS, not the local-disk picker. We feature
 * -detect and surface that rather than throwing. Handles *do* persist via
 * IndexedDB, so a granted folder re-authorises with one click, not a re-pick.
 */
import { openDB, type IDBPDatabase } from 'idb'

// --- Tiny IndexedDB keyval (via `idb`, already a dep) ---------------------
// A one-store keyval DB scoped to this demo, used to persist the granted root
// handle across sessions. `idb-keyval` would do this in one import but isn't
// installed; this is the same idea in ~10 lines and keeps deps unchanged.

const DB_NAME = 'tl-os'
const STORE = 'keyval'
let dbPromise: Promise<IDBPDatabase> | null = null
function db(): Promise<IDBPDatabase> {
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, 1, {
			upgrade(database) {
				database.createObjectStore(STORE)
			},
		})
	}
	return dbPromise
}
async function get<T>(key: string): Promise<T | undefined> {
	return (await db()).get(STORE, key) as Promise<T | undefined>
}
async function set(key: string, value: unknown): Promise<void> {
	await (await db()).put(STORE, value, key)
}
async function del(key: string): Promise<void> {
	await (await db()).delete(STORE, key)
}

// --- Minimal File System Access API types --------------------------------
// @types/wicg-file-system-access isn't installed (and we don't want the dep for
// a demo), and these aren't in the default TS DOM lib yet. Declare just what we
// use. `FileSystemFileHandle` already exists in lib.dom; we widen the directory
// handle and the `window.showDirectoryPicker` global.

/** A permission descriptor for query/requestPermission. */
interface FsPermissionDescriptor {
	mode?: 'read' | 'readwrite'
}

/** The subset of FileSystemDirectoryHandle we rely on. lib.dom's built-in type
 *  is missing the async iterator + permission methods in some TS versions, so
 *  we declare our own and cast at the picker boundary. */
export interface DirHandle {
	readonly kind: 'directory'
	readonly name: string
	entries(): AsyncIterableIterator<[string, FileHandleLike]>
	queryPermission?(desc?: FsPermissionDescriptor): Promise<PermissionState>
	requestPermission?(desc?: FsPermissionDescriptor): Promise<PermissionState>
}

/** The subset of a file/dir handle we read out of `entries()`. */
export interface FileHandleLike {
	readonly kind: 'file' | 'directory'
	readonly name: string
	getFile?(): Promise<File>
}

declare global {
	interface Window {
		showDirectoryPicker?(options?: {
			id?: string
			mode?: 'read' | 'readwrite'
			/** A well-known dir to open the picker in ('documents', 'desktop', …). */
			startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
		}): Promise<DirHandle>
	}
}

// --- Feature detection ----------------------------------------------------

/** True when this browser can bind a local directory (Chromium-family). */
export function fsAccessSupported(): boolean {
	return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

// --- Handle persistence ---------------------------------------------------
// One granted root per demo, remembered across reloads. idb-keyval stores the
// live handle object (structured-clonable); on reload we re-verify permission.

const ROOT_KEY = 'tl-os:root-dir-handle'

/** Prompt the user to grant a directory; persist the handle. Returns null if
 *  they cancel. Requests readwrite up front so later moves/renames don't
 *  re-prompt (v1 only reads, but the grant is the natural place to ask).
 *  Opens the picker *in* the user's Documents folder so the common case
 *  ("Finder View" → my documents) is a single confirming click — the browser
 *  sandbox still requires that confirmation; it can't silently grant a folder. */
export async function pickRootDirectory(): Promise<DirHandle | null> {
	if (!window.showDirectoryPicker) return null
	try {
		const handle = await window.showDirectoryPicker({
			id: 'tl-os-root',
			mode: 'readwrite',
			startIn: 'documents',
		})
		await set(ROOT_KEY, handle)
		return handle
	} catch (err) {
		// AbortError = user dismissed the picker; treat as a no-op, not an error.
		if (err instanceof DOMException && err.name === 'AbortError') return null
		throw err
	}
}

/** The remembered root handle from a previous session, if any. Does NOT verify
 *  permission — call `ensurePermission` before reading. */
export async function loadRememberedRoot(): Promise<DirHandle | null> {
	const handle = (await get(ROOT_KEY)) as DirHandle | undefined
	return handle ?? null
}

/** Forget the granted root (e.g. a "disconnect folder" action). */
export async function forgetRoot(): Promise<void> {
	await del(ROOT_KEY)
}

/**
 * Ensure we hold `read`/`readwrite` permission on a handle.
 * On reload a persisted handle needs re-authorisation; `requestPermission`
 * MUST be called from a user gesture (a click), so pass `{ interactive: true }`
 * only from an event handler. With `interactive: false` we merely query — used
 * to decide whether to show a "reconnect" button vs. read straight away.
 */
export async function ensurePermission(
	handle: DirHandle,
	opts: { interactive?: boolean; mode?: 'read' | 'readwrite' } = {},
): Promise<boolean> {
	const mode = opts.mode ?? 'read'
	const query = handle.queryPermission ? await handle.queryPermission({ mode }) : 'prompt'
	if (query === 'granted') return true
	if (!opts.interactive) return false
	const req = handle.requestPermission ? await handle.requestPermission({ mode }) : 'denied'
	return req === 'granted'
}

// --- Reading a directory --------------------------------------------------

/** A file/folder pointer as the canvas sees it. `path` is root-relative and is
 *  the join key between a canvas file-shape and the disk. No handle is stored
 *  here — it's re-derived on demand (see `getFileHandle`). */
export interface DirEntry {
	/** Root-relative path, POSIX-style ("photos/cat.png"). Stable join key. */
	path: string
	name: string
	kind: 'file' | 'directory'
	/** File extension without the dot, lowercased ("png"); '' for dirs/no-ext. */
	ext: string
}

function extOf(name: string): string {
	const dot = name.lastIndexOf('.')
	if (dot <= 0 || dot === name.length - 1) return ''
	return name.slice(dot + 1).toLowerCase()
}

/**
 * Read one directory (non-recursive) into `DirEntry` pointers. `subPath` is the
 * root-relative path of the directory to read ('' = the root itself). Entries
 * are returned sorted: directories first, then files, each alphabetical — a
 * sensible *starting* order for the initial grid layout (the user rearranges).
 */
export async function readDirectory(root: DirHandle, subPath = ''): Promise<DirEntry[]> {
	const dir = subPath ? await resolveDir(root, subPath) : root
	if (!dir) return []
	const out: DirEntry[] = []
	for await (const [name, child] of dir.entries()) {
		const path = subPath ? `${subPath}/${name}` : name
		out.push({ path, name, kind: child.kind, ext: child.kind === 'file' ? extOf(name) : '' })
	}
	out.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
		return a.name.localeCompare(b.name)
	})
	return out
}

/** Walk root → the directory at `subPath`, or null if any segment is missing. */
async function resolveDir(root: DirHandle, subPath: string): Promise<DirHandle | null> {
	let dir: DirHandle = root
	for (const seg of subPath.split('/').filter(Boolean)) {
		let next: DirHandle | null = null
		for await (const [name, child] of dir.entries()) {
			if (name === seg && child.kind === 'directory') {
				next = child as unknown as DirHandle
				break
			}
		}
		if (!next) return null
		dir = next
	}
	return dir
}

/** Resolve a file handle for a root-relative path, or null if it's gone. */
export async function getFileHandle(root: DirHandle, path: string): Promise<FileHandleLike | null> {
	const segs = path.split('/').filter(Boolean)
	const name = segs.pop()
	if (!name) return null
	const dir = segs.length ? await resolveDir(root, segs.join('/')) : root
	if (!dir) return null
	for await (const [entryName, child] of dir.entries()) {
		if (entryName === name && child.kind === 'file') return child
	}
	return null
}

/** Read a file's bytes as a Blob (for opening / thumbnailing). */
export async function readFileBlob(root: DirHandle, path: string): Promise<Blob | null> {
	const handle = await getFileHandle(root, path)
	if (!handle?.getFile) return null
	return handle.getFile()
}
