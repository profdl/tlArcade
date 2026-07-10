import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import './App.css'

// Blank scaffold for the "tl-os" demo. A plain tldraw canvas with its own
// persistenceKey so it doesn't share a localStorage document with any other
// demo. Build the desktop/OS metaphor out from here — see CLAUDE.md.
export default function App() {
	return (
		<div className="tlos-root">
			<Tldraw persistenceKey="tl-os" />
		</div>
	)
}
