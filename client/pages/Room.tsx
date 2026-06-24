import { useSync } from '@tldraw/sync'
import { ReactNode, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Tldraw } from 'tldraw'
import { getBookmarkPreview } from '../getBookmarkPreview'
import { multiplayerAssetStore } from '../multiplayerAssetStore'
import { registerContainment } from '../containment/registerContainment'
import { registerSnapping } from '../grid/registerSnapping'
import { onRefereePrivateMessage } from '../referee/privateReveals'
import { gameBindingUtils, gameShapeUtils, gameTools } from '../shapes/registry'
import { createGameComponents } from '../ui/components'

export function Room() {
	const { roomId } = useParams<{ roomId: string }>()

	// Create a store connected to multiplayer.
	// IMPORTANT (v5 + sync): custom shapes must be registered with the STORE
	// SCHEMA here, not only on <Tldraw>. Otherwise synced custom shapes fail
	// validation when another client loads them.
	const store = useSync({
		// We need to know the websockets URI...
		uri: `${window.location.origin}/api/connect/${roomId}`,
		// ...and how to handle static assets like images & videos
		assets: multiplayerAssetStore,
		// ...and our custom game shapes + bindings, so the synced schema knows them.
		shapeUtils: gameShapeUtils,
		bindingUtils: gameBindingUtils,
		// the ONLY client-bound referee channel: private (owner-only) reveals are
		// pushed here (public results arrive via normal store sync). See SPEC §3.4.
		onCustomMessageReceived: onRefereePrivateMessage,
	})

	// Components carry the roomId so referee-backed actions can reach the server.
	const components = useMemo(() => createGameComponents(roomId), [roomId])

	return (
		<RoomWrapper roomId={roomId}>
			<Tldraw
				// we can pass the connected store into the Tldraw component which will handle
				// loading states & enable multiplayer UX like cursors & a presence menu
				store={store}
				// the same custom shapes + bindings + tools must also be given to the editor
				shapeUtils={gameShapeUtils}
				bindingUtils={gameBindingUtils}
				tools={gameTools}
				// custom UI (main menu, context menu, ...) — see client/ui/components.tsx
				components={components}
				options={{ deepLinks: true }}
				onMount={(editor) => {
					// when the editor is ready, we need to register our bookmark unfurling service
					editor.registerExternalAssetHandler('url', getBookmarkPreview)
					// editor behaviours: drop-into-container (§4.2) + grid snapping (§4.1).
					const disposers = [registerContainment(editor), registerSnapping(editor)]
					return () => disposers.forEach((d) => d())
				}}
			/>
		</RoomWrapper>
	)
}

function RoomWrapper({ children, roomId }: { children: ReactNode; roomId?: string }) {
	const [didCopy, setDidCopy] = useState(false)

	useEffect(() => {
		if (!didCopy) return
		const timeout = setTimeout(() => setDidCopy(false), 3000)
		return () => clearTimeout(timeout)
	}, [didCopy])

	return (
		<div className="RoomWrapper">
			<div className="RoomWrapper-header">
				<WifiIcon />
				<div>{roomId}</div>
				<button
					className="RoomWrapper-copy"
					onClick={() => {
						navigator.clipboard.writeText(window.location.href)
						setDidCopy(true)
					}}
					aria-label="copy room link"
				>
					Copy link
					{didCopy && <div className="RoomWrapper-copied">Copied!</div>}
				</button>
			</div>
			<div className="RoomWrapper-content">{children}</div>
		</div>
	)
}

function WifiIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			strokeWidth="1.5"
			stroke="currentColor"
			width={16}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z"
			/>
		</svg>
	)
}
