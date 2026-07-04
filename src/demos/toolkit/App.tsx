import { Route, Routes } from 'react-router-dom'
import './index.css'
import { Room } from './pages/Room'
import { Root } from './pages/Root'

// Nested under the switcher's /demos/toolkit/* route (see src/App.tsx) instead
// of owning its own top-level router the way the standalone app did.
export default function App() {
	return (
		<Routes>
			<Route path="/" element={<Root />} />
			<Route path=":roomId" element={<Room />} />
		</Routes>
	)
}
