import { Link } from 'react-router-dom'
import { demos } from './demos/manifest'
import './Home.css'

export default function Home() {
	return (
		<div className="switcher">
			<h1 className="switcher-title">tlArcade</h1>
			<p className="switcher-sub">A collection of tldraw-based prototypes.</p>
			<div className="switcher-grid">
				{demos.map((demo) => (
					<Link key={demo.slug} to={`/demos/${demo.slug}`} className="switcher-card">
						<h2 className="switcher-card-title">{demo.title}</h2>
						<p className="switcher-card-blurb">{demo.blurb}</p>
					</Link>
				))}
			</div>
		</div>
	)
}
