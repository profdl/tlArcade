import { Link } from 'react-router-dom'
import type { DemoEntry } from './demos/manifest'
import './DemoLayout.css'

// Every demo's own root is `position: fixed; inset: 0`, which normally
// ignores any wrapping container and covers the real viewport. Giving
// `.demo-content` a `transform` makes it the containing block for `fixed`
// descendants instead (a standard CSS trick), so a demo's `inset: 0`
// resolves against the space below the nav bar rather than the whole screen.
export default function DemoLayout({ demo }: { demo: DemoEntry }) {
	return (
		<div className="demo-layout">
			<nav className="demo-nav">
				<Link to="/" className="demo-nav-back">
					← All demos
				</Link>
				<span className="demo-nav-title">{demo.title}</span>
			</nav>
			<div className="demo-content" data-demo={demo.slug}>
				<demo.Component />
			</div>
		</div>
	)
}
