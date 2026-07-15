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
		slug: 'engine',
		title: 'Engine',
		blurb:
			'A drag-and-drop game builder — drop players, walls, tokens, hazards, and goals from a tray, draw terrain with the pencil, then hit Play to test-drive a platformer.',
		Component: lazy(() => import('./engine/App')),
	},
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
		slug: 'sonic',
		title: 'Sonic',
		blurb:
			'A momentum platformer: draw slopes, ramps, and loops, then run a self-propelled character that keeps its speed across curves and flies off ramps — the Line Rider sled sim turned into a Sonic-style level builder.',
		Component: lazy(() => import('./sonic/App')),
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
		slug: 'ant-mover',
		title: 'Ant-Mover',
		blurb:
			'A multiplayer piano-movers game: many players each grab anywhere on one rigid T-piece and drag it through a tight maze, with a server-authoritative planck.js physics sim. Coordinate and it glides; fight and it jams.',
		// Nested sub-routes: a lobby (/demos/ant-mover) redirects to a per-room game
		// (/demos/ant-mover/:roomId), mirroring the Toolkit — the room id in the URL
		// is the invite link. See ant-mover/App.tsx.
		path: '/demos/ant-mover/*',
		Component: lazy(() => import('./ant-mover/App')),
	},
	{
		slug: 'scale-portals',
		title: 'Scale Portals',
		blurb:
			'Walk a top-down map of WFC-generated rooms, then step into a portal room that holds a whole smaller map — the camera dives in and out between scales.',
		Component: lazy(() => import('./scale-portals/App')),
	},
	{
		slug: 'scale-rooms',
		title: 'Scale Rooms',
		blurb:
			'A telescope of square rooms nested 16 scales deep — smaller rooms overlap larger ones, no hallways. Step onto a room’s orange doorway and the camera dives into it.',
		Component: lazy(() => import('./scale-rooms/App')),
	},
	{
		slug: 'rig-play',
		title: 'Rig Play',
		blurb:
			'A focused rig playground: drop a pre-rigged figure (or draw your own and draw bones on it), then hit Play and drive it with the keyboard — A/D walk, W/Space jump, S crouch, E wave — as a pure procedural state machine animates the whole body. The Engine demo’s rig, lifted out of the platformer.',
		Component: lazy(() => import('./rig-play/App')),
	},
	{
		slug: 'poser',
		title: 'Poser',
		blurb:
			'Pose an articulated stick figure built from native tldraw shapes — drag any bone and the connected limbs follow their parent joint (forward kinematics).',
		Component: lazy(() => import('./poser/App')),
	},
	{
		slug: 'puppet',
		title: 'Puppet',
		blurb:
			'A VTuber-style rig on the canvas — drive a layered character with live webcam face tracking (head pose, blinks, brows, lipsync) plus manual expression and pose controls.',
		Component: lazy(() => import('./puppet/App')),
	},
	{
		slug: 'tl-os',
		title: 'tl-OS',
		blurb:
			'A spatial file workspace — bind a real local folder (Chrome/Edge) and lay its files out as icon-shapes on the canvas, then open them with a double-click.',
		Component: lazy(() => import('./tl-os/App')),
	},
	{
		slug: 'toolkit',
		title: 'Toolkit',
		blurb:
			'A multiplayer tabletop toolkit — synced tokens, dice, cards, and creatures on a shared canvas, backed by a server-authoritative referee.',
		path: '/demos/toolkit/*',
		Component: lazy(() => import('./toolkit/App')),
	},
]
