/**
 * Busytown — UI icons in tldraw's native style: monochrome, thin geometric
 * strokes on a 24px grid, drawn with `currentColor` so they pick up button
 * text colour. Used by the HUD controls (drop palette + play/pause).
 */
import type { ReactNode } from 'react'

/** Icon keys are open: a new character registers its glyph here (or supplies
 *  its own ReactNode in CharacterDef.palette.icon). The HUD chrome uses the
 *  fixed play/pause pair. */
export type IconName = string

const PATHS: Record<string, ReactNode> = {
  person: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 19c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    </>
  ),
  house: (
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6.5 10.5V20h11v-9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  tree: (
    <>
      <circle cx="12" cy="9" r="5.5" />
      <path d="M12 14.5V20" />
    </>
  ),
  bench: (
    <>
      <path d="M5 12.5h14" />
      <path d="M5 8.5h14" />
      <path d="M8 12.5v-4M12 12.5v-4M16 12.5v-4" />
      <path d="M6.5 12.5V17M17.5 12.5V17" />
    </>
  ),
  stall: (
    <>
      <path d="M4 9.5 6.2 5h11.6L20 9.5" />
      <path d="M4 9.5h16" />
      <path d="M6.5 9.5V19h11V9.5" />
      <path d="M9.6 9.5 10.8 5M14.4 9.5 13.2 5" />
    </>
  ),
  bird: (
    <>
      <path d="M4.5 15c0-3.6 3-6 6.5-5.6 1.6.2 2.8 1 3.6 2.1l3.4-1-1.8 3c.2 3-2 5.2-5 5.2-3.4 0-6.8-1.4-6.8-3.7Z" />
      <path d="M15.2 10.8 18.7 12l-3.1 1.2" />
      <circle cx="12.8" cy="12" r="0.5" fill="currentColor" stroke="none" />
    </>
  ),
  dog: (
    <>
      <path d="M4.5 10V7.5l2.5 2h4l2-2V10" />
      <path d="M4.5 10c0 3 1.8 4.5 4.5 4.5s4.5-1.5 4.5-4.5" />
      <path d="M13.5 11.5c2.5 0 4-1.2 5-3l1 1.2-.6 2.3c0 3.2-2.4 5.2-5.4 5.2" />
      <path d="M6.5 14.5V18M11 14.5V18" />
    </>
  ),
  pond: (
    <>
      <ellipse cx="12" cy="14" rx="8" ry="4" />
      <path d="M7 9.5c1-.8 2-.8 3 0M14 8c1-.8 2-.8 3 0" />
    </>
  ),
  snail: (
    <>
      <path d="M3 17.5c0 1.4 1.2 2.5 3 2.5h9" />
      <circle cx="9" cy="12.5" r="4" />
      <path d="M14.5 16c1.7-.2 3-1.4 3.6-3" />
      <path d="M17.6 12.4c.5-1 1-2.2 1-3.4" />
      <path d="M19.6 12c.8-.7 1.5-1.7 1.9-2.9" />
      <circle cx="18.6" cy="8.4" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="21.6" cy="8.7" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  brick: (
    <>
      <rect x="4" y="8.5" width="16" height="7" rx="1" />
      <path d="M12 8.5v7" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 15.5V7.5H14v8" />
      <path d="M14 10h3.2l2.8 3.2v2.3h-1.4" />
      <path d="M2.5 15.5h2.3M8.7 15.5H14" />
      <circle cx="6.7" cy="16" r="1.7" />
      <circle cx="16.3" cy="16" r="1.7" />
    </>
  ),
  factory: (
    <>
      <path d="M4 19V9.5l4.7 3.3V9.5l4.7 3.3V9.5L18 12.8V19" />
      <path d="M3 19h18" />
      <path d="M16.8 9.7V4.5h2.2V13" />
      <path d="M10 19v-3.5h3V19" />
    </>
  ),
  flower: (
    <>
      <circle cx="12" cy="10" r="2" />
      <circle cx="12" cy="5.6" r="2.1" />
      <circle cx="16.2" cy="8.7" r="2.1" />
      <circle cx="14.6" cy="13.5" r="2.1" />
      <circle cx="9.4" cy="13.5" r="2.1" />
      <circle cx="7.8" cy="8.7" r="2.1" />
      <path d="M12 12v7" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-7 5-12 14-14 0 9-5 14-14 14Z" />
      <path d="M12.5 11.5c-2.2 2-4 4.4-5 7.5" />
    </>
  ),
  vine: (
    <>
      <path d="M11 21c3-3-3-5 0-8s-3-5 1-9" />
      <path d="M11 15.5c2 .3 3.3-.6 3.7-2.3-1.7-.2-2.9.7-3.7 2.3Z" />
      <path d="M10.4 9.6c-2-.2-3.3-1.2-3.5-3 1.8-.1 3 .8 3.5 3Z" />
    </>
  ),
  carrot: (
    <>
      <path d="M11 9 6 20c5 1 9-2 10-7l-5-4Z" />
      <path d="M11 9c1-2 3-3 5-2M11 9c-.5-2-2-3.4-4-3.4M11 9c0-2 1-4 3-5" />
    </>
  ),
  tomato: (
    <>
      <circle cx="12" cy="14" r="6" />
      <path d="M12 8V5M12 8l-2.5-2M12 8l2.5-2" />
    </>
  ),
  cabbage: (
    <>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 6v14M6.5 10.5c3 1.5 8 1.5 11 0M6 15c3.5 1.7 8.5 1.7 12 0" />
    </>
  ),
  sign: (
    <>
      <path d="M12 12v8" />
      <rect x="4.5" y="5" width="15" height="7" rx="1.2" />
      <path d="M8 8.5h8" />
    </>
  ),
  play: <path d="M8 6.2 18 12 8 17.8Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="8" y="7" width="2.6" height="10" rx="0.7" fill="currentColor" stroke="none" />
      <rect x="13.4" y="7" width="2.6" height="10" rx="0.7" fill="currentColor" stroke="none" />
    </>
  ),
}

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
