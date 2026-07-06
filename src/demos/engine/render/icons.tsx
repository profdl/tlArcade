/**
 * Engine — tray icons.
 *
 * Each icon is a tiny SVG of the role's actual geo shape in its role color —
 * a filled outline like tldraw's own shapes — so the tray reads as "drop THIS
 * shape" rather than a generic emoji. Solids are drawn filled; triggers get a
 * translucent fill, matching how they look on the canvas.
 */
import { ROLES, type Role } from '../game/roles'

/** tldraw light-theme solid colors for the role palette. */
const HEX: Record<string, string> = {
  blue: '#4465e9',
  grey: '#9fa8b2',
  yellow: '#f1ac4b',
  red: '#e03131',
  green: '#099268',
  violet: '#ae3ec9',
  orange: '#e16919',
  'light-blue': '#4dabf7',
  'light-green': '#40c057',
  'light-red': '#ff8787',
  'light-violet': '#e599f7',
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function starPoints(cx: number, cy: number, outer: number, inner: number, n = 5): string {
  const pts: string[] = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / n
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`)
  }
  return pts.join(' ')
}

export function RoleIcon({ role, size = 24 }: { role: Role; size?: number }) {
  const def = ROLES[role]
  const stroke = HEX[def.color] ?? '#1d1d1d'
  const paint = {
    fill: rgba(stroke, def.collision === 'solid' ? 0.85 : 0.22),
    stroke,
    strokeWidth: 1.6,
    strokeLinejoin: 'round' as const,
  }
  let shape
  switch (role) {
    case 'player':
      shape = <ellipse cx={12} cy={12} rx={6} ry={8.5} {...paint} />
      break
    case 'wall':
      shape = <rect x={2} y={8.5} width={20} height={7} rx={1.5} {...paint} />
      break
    case 'goal':
      shape = <rect x={7} y={3} width={10} height={18} rx={1.5} {...paint} />
      break
    case 'hazard':
      shape = <polygon points="12,3.5 21,19.5 3,19.5" {...paint} />
      break
    case 'token':
      shape = <polygon points={starPoints(12, 12.5, 9, 3.9)} {...paint} />
      break
    case 'enemy':
      // A little walker: a rounded body with two "feet" notches read as an enemy.
      shape = <rect x={3.5} y={6} width={17} height={13} rx={3} {...paint} />
      break
    case 'spring':
      // A bounce pad: a wide short pad with an up-arrow hint above it (the coil
      // spring launching the player skyward).
      shape = (
        <g>
          <rect x={3} y={15} width={18} height={5} rx={1.5} {...paint} />
          <path
            d="M12 4 L12 13 M12 4 L8.5 7.5 M12 4 L15.5 7.5"
            fill="none"
            stroke={stroke}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )
      break
    case 'checkpoint':
      // A little flag on a pole: the pole is the tall thin marker, the pennant
      // reads as "checkpoint".
      shape = (
        <g>
          <line x1={7.5} y1={3} x2={7.5} y2={21} stroke={stroke} strokeWidth={1.8} strokeLinecap="round" />
          <polygon points="7.5,4 18,7 7.5,11" {...paint} />
        </g>
      )
      break
    case 'oneway':
      // A thin dashed platform: solid from above, pass-through from below — the
      // dashes read as "not a full wall".
      shape = (
        <rect
          x={2}
          y={11}
          width={20}
          height={3.5}
          rx={1}
          {...paint}
          strokeDasharray="3 2.5"
        />
      )
      break
    case 'platform':
      // A moving platform: a grey slab with a DASHED outline + a small ↔ hint, so it
      // reads as "a wall-like surface that MOVES", matching its dashed canvas look.
      shape = (
        <g>
          <rect x={2} y={9.5} width={20} height={6} rx={1.5} {...paint} strokeDasharray="3 2" />
          <path
            d="M6 12.5 L3.5 12.5 M3.5 12.5 L5 11 M3.5 12.5 L5 14 M18 12.5 L20.5 12.5 M20.5 12.5 L19 11 M20.5 12.5 L19 14"
            fill="none"
            stroke={stroke}
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )
      break
    case 'block':
      // A hittable ?-block: a solid square with a "?" — bonk it from below.
      shape = (
        <g>
          <rect x={4} y={4} width={16} height={16} rx={2.5} {...paint} />
          <text
            x={12}
            y={16.5}
            textAnchor="middle"
            fontSize={12}
            fontWeight={700}
            fill={stroke}
            fontFamily="system-ui, sans-serif"
          >
            ?
          </text>
        </g>
      )
      break
    case 'portal':
      // A warp portal: a doorway ellipse with an inner swirl ring.
      shape = (
        <g>
          <ellipse cx={12} cy={12} rx={7} ry={9} {...paint} />
          <ellipse cx={12} cy={12} rx={3.5} ry={5} fill="none" stroke={stroke} strokeWidth={1.4} />
        </g>
      )
      break
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      {shape}
    </svg>
  )
}
