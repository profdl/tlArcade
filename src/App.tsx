import { Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
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
							path={`/demos/${demo.slug}`}
							element={
								<div data-demo={demo.slug} style={{ position: 'fixed', inset: 0 }}>
									<demo.Component />
								</div>
							}
						/>
					))}
				</Routes>
			</Suspense>
		</BrowserRouter>
	)
}

export default App
