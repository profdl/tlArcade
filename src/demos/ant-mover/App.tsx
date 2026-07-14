// Ant-mover is multiplayer: a lobby that mints a room id and a per-room game,
// mirroring the Toolkit. Nested under the switcher's /demos/ant-mover/* route
// (see src/App.tsx + the manifest `path`). The game itself lives in pages/Room.
import { Route, Routes } from 'react-router-dom'
import { Root } from './pages/Root'
import { Room } from './pages/Room'
import './App.css'

export default function App() {
	return (
		<Routes>
			<Route path="/" element={<Root />} />
			<Route path=":roomId" element={<Room />} />
		</Routes>
	)
}
