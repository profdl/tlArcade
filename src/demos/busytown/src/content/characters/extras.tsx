/**
 * Proof-of-flexibility characters — added purely by registration.
 * ----------------------------------------------------------------
 * `dog`  proves the BEHAVIOR axis: it carries a NEW component field (`chase`)
 *        and a NEW system (dogSystem, in sim/systems.ts) that a scene opts into
 *        via its pipeline. No engine query changes — the dog is invisible to
 *        every existing system because it lacks their components.
 * `pond` proves the PROP/AFFORDANCE axis: a NEW prop kind advertising a NEW
 *        affordance tag ('drink') the engine has never seen. Because EntityKind
 *        and AffordanceTag are open strings, no union edits are needed; the dog
 *        detours to the nearest 'drink' prop when it gets thirsty.
 */
import { poly, ring, seg, s } from '../../render/freehand'
import { Icon } from '../../render/icons'
import { MOVE } from '../../sim/config'
import type { CharacterDef } from './types'
import type { Vec2 } from '../../sim/components'

const clone = (at: Vec2): Vec2 => ({ x: at.x, y: at.y })

// ── dog (new behavior: chases the nearest townsperson) ────────────────────────
const dog: CharacterDef = {
  kind: 'dog',
  size: 84,
  color: 'yellow',
  // A side-view pup: oval body, round head, snout, ears, four legs and a tail.
  art: [
    s(ring(42, 58, 22, 13), 'm', true), // body
    s(ring(70, 47, 12, 11), 'm', true), // head
    s(poly([[80, 46], [90, 48], [80, 53]]), 's'), // snout
    s(ring(74, 44, 1.2, 1.2), 's', true), // eye
    s(seg(64, 38, 60, 30), 'm'), // ear
    s(seg(30, 68, 30, 84), 'm'), // legs
    s(seg(42, 68, 42, 84), 'm'),
    s(seg(52, 68, 52, 84), 'm'),
    s(seg(60, 68, 60, 84), 'm'),
    s(seg(21, 52, 12, 44), 'm'), // tail (up = happy)
  ],
  spawn: (at) => ({
    kind: 'dog',
    position: clone(at),
    sprite: { shape: 'dog' },
    chase: { speed: MOVE.WALK * 0.85, mode: 'follow', until: 0 },
  }),
  palette: { label: 'Dog', icon: <Icon name="dog" /> },
  thought: (e) => (e.chase?.mode === 'drink' ? 'Thirsty!' : ''),
}

// ── pond (new prop: advertises the 'drink' affordance) ────────────────────────
const pond: CharacterDef = {
  kind: 'pond',
  size: 200,
  color: 'light-blue',
  art: [
    s(ring(50, 62, 38, 20), 'm', true), // water
    s(poly([[26, 58], [34, 62], [42, 58]]), 's'), // ripples
    s(poly([[58, 66], [66, 70], [74, 66]]), 's'),
  ],
  spawn: (at) => ({
    kind: 'pond',
    position: clone(at),
    sprite: { shape: 'pond' },
    affordance: { tags: ['drink'], capacity: 99, occupants: 0 },
  }),
  palette: { label: 'Pond', icon: <Icon name="pond" /> },
}

export const EXTRA_CHARACTERS: CharacterDef[] = [dog, pond]
