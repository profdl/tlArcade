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
]
