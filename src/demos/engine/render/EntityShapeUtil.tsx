/**
 * Engine — the one custom shape behind every game element.
 *
 * There is a single shape type (`gameEntity`); its `role` prop selects which
 * element it is (see game/roles.ts). Solids (player, wall) render as filled
 * blocks; triggers (token, hazard, goal) render as translucent dashed zones, so
 * "will this stop me?" vs "will this fire when I touch it?" reads at a glance.
 *
 * tldraw v5 registers a custom shape by augmenting TLGlobalShapePropsMap, which
 * folds `'gameEntity'` into the TLShape union so the typed editor APIs
 * (createShape / updateShape / TLShapePartial) accept it.
 */
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw'
import { ROLES, isRole, type Role } from '../game/roles'

export type GameEntityProps = {
  w: number
  h: number
  /** One of Role (see roles.ts); a string in the schema since it's user data. */
  role: string
}
export type GameEntityShape = TLBaseShape<'gameEntity', GameEntityProps>

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    gameEntity: GameEntityProps
  }
}

/** Turn a #rrggbb into an rgba() at the given alpha. */
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export class EntityShapeUtil extends BaseBoxShapeUtil<GameEntityShape> {
  static override type = 'gameEntity' as const
  static override props: RecordProps<GameEntityShape> = {
    w: T.number,
    h: T.number,
    role: T.string,
  }

  override getDefaultProps(): GameEntityProps {
    const { w, h } = ROLES.wall.size
    return { w, h, role: 'wall' }
  }

  // Authoring is free-form: every element is draggable, resizable, deletable.
  // The runtime (game/engine.ts) drives only the player during play.

  override component(shape: GameEntityShape) {
    const { w, h, role: rawRole } = shape.props
    const role: Role = isRole(rawRole) ? rawRole : 'wall'
    const def = ROLES[role]
    const solid = def.collision === 'solid'
    const glyph = Math.max(12, Math.min(w, h) * 0.62)
    return (
      <HTMLContainer
        style={{
          width: w,
          height: h,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: role === 'token' ? '50%' : 8,
          background: solid ? tint(def.color, 0.9) : tint(def.color, 0.18),
          border: `${solid ? 2 : 2.5}px ${solid ? 'solid' : 'dashed'} ${def.color}`,
          boxSizing: 'border-box',
          overflow: 'hidden',
          fontSize: glyph,
          lineHeight: 1,
          userSelect: 'none',
        }}
      >
        <span style={{ filter: solid ? 'drop-shadow(0 1px 1px rgba(0,0,0,0.25))' : 'none' }}>
          {def.emoji}
        </span>
      </HTMLContainer>
    )
  }

  override getIndicatorPath() {
    return undefined
  }
}
