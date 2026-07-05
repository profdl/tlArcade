import { lazy, type ComponentType } from 'react'

export interface DemoEntry {
	slug: string
	title: string
	blurb: string
	Component: ComponentType
	/** Route path, for demos with their own nested sub-routes. Defaults to `/demos/${slug}`. */
	path?: string
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
	{
		slug: 'busytown',
		title: 'Busytown',
		blurb:
			'A living little town on the canvas — drop characters, props, and vehicles and watch an ECS sim drive whims, greetings, and deliveries.',
		Component: lazy(() => import('./busytown/App')),
	},
	{
		slug: 'face-mask',
		title: 'Face Mask',
		blurb:
			'Point your webcam at your face and pin native tldraw shapes to tracked landmarks — snap a mask, glasses, or doodles onto a live feed.',
		Component: lazy(() => import('./face-mask/App')),
	},
	{
		slug: 'toolkit',
		title: 'Toolkit',
		blurb:
			'A multiplayer tabletop toolkit — synced tokens, dice, cards, and creatures on a shared canvas, backed by a server-authoritative referee.',
		path: '/demos/toolkit/*',
		Component: lazy(() => import('./toolkit/App')),
	},
	{
		slug: 'scale-rooms',
		title: 'Scale Rooms',
		blurb:
			'A telescope of square rooms nested 16 scales deep — smaller rooms overlap larger ones, no hallways. Step onto a room’s orange doorway and the camera dives into it.',
		Component: lazy(() => import('./scale-rooms/App')),
	},
]
