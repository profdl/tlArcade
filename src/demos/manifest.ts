import { lazy, type ComponentType } from 'react'

export interface DemoEntry {
	slug: string
	title: string
	blurb: string
	Component: ComponentType
}

export const demos: DemoEntry[] = [
	{
		slug: 'line-rider-classic',
		title: 'Line Rider: Classic',
		blurb:
			'Draw a track with native tldraw shapes, hit play, and watch a snail ride it under a hand-rolled Verlet physics sim. Flags and portals included.',
		Component: lazy(() => import('./line-rider-classic/App')),
	},
	{
		slug: 'line-rider-machines',
		title: 'Line Rider: Machines',
		blurb:
			'Line Rider classic plus a drag-and-drop tray for portal and multiplier pieces — build track machinery without hand-drawing every mouth.',
		Component: lazy(() => import('./line-rider-machines/App')),
	},
	{
		slug: 'line-rider-side',
		title: 'Line Rider: Side Mode',
		blurb:
			'A diverged take: draw ramps live while riding, in an editable canvas that keeps up with a self-recovering, side-scrolling sled.',
		Component: lazy(() => import('./line-rider-side/App')),
	},
]
