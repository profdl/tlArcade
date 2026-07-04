import { Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import DemoLayout from './DemoLayout'
import { demos } from './demos/manifest'
import Home from './Home'

function App() {
	return (
		<BrowserRouter>
			<Suspense fallback={null}>
				<Routes>
					<Route path="/" element={<Home />} />
					{demos.map((demo) => (
						<Route
							key={demo.slug}
							path={demo.path ?? `/demos/${demo.slug}`}
							element={<DemoLayout demo={demo} />}
						/>
					))}
				</Routes>
			</Suspense>
		</BrowserRouter>
	)
}

export default App
