// Ant-mover lobby. Mirrors toolkit/pages/Root.tsx: the demo has no top-level
// landing page of its own — it just mints (or reuses) a room id and redirects to
// the per-room game at /demos/ant-mover/:roomId. The room id lives in the URL so
// sharing the link IS the invite (see pages/Room.tsx "Copy link").

import { Navigate } from 'react-router-dom'
import { uniqueId } from 'tldraw'

// Own localStorage key (repo uniqueness rule — never share an identifier across
// demos). Wrapped in try/catch because localStorage can be unavailable/blocked.
const ROOM_KEY = 'am-my-local-room-id'

function readRoom(): string | null {
	try {
		return localStorage.getItem(ROOM_KEY)
	} catch {
		return null
	}
}
function writeRoom(id: string): void {
	try {
		localStorage.setItem(ROOM_KEY, id)
	} catch {
		// Ignore — a fresh id is minted each visit if we can't persist it.
	}
}

const myRoomId = readRoom() ?? 'am-room-' + uniqueId()
writeRoom(myRoomId)

export function Root() {
	// Relative (no leading slash): resolves against the parent /demos/ant-mover/*
	// match, not the document root.
	return <Navigate to={myRoomId} replace />
}
