/**
 * Engine — the live physics debug panel.
 *
 * A floating panel (mounted via components.InFrontOfTheCanvas alongside the tray)
 * that shows ONLY during play and lets you dial the "game feel" tunables live —
 * accel, friction, coyote/buffer windows, jump cut, gravity asymmetry. Every
 * slider writes to `tunablesAtom`, which the runtime reads each substep, so the
 * change is felt on the very next jump — no rebuild, no restart.
 *
 * Once you've found the feel, hit **Copy** to grab the values as a JSON block and
 * paste them into game/physics.ts → PHYSICS_DEFAULTS as the new baseline. **Reset**
 * restores the shipped defaults.
 *
 * Like the tray, it reads/writes atoms (not props) so App's `components` object
 * keeps stable identity (see App.tsx / game/state.ts). It sits in the
 * pointer-events:none InFrontOfTheCanvas layer, so it opts back in via CSS.
 */
import { useState } from 'react'
import { useValue } from 'tldraw'
import { PHYSICS_DEFAULTS, TUNABLE_GROUPS, makeTunables } from '../game/physics'
import { legModeAtom, playingAtom, tunablesAtom } from '../game/state'

export function PhysicsPanel() {
  const playing = useValue('physics panel: playing', () => playingAtom.get(), [])
  const tunables = useValue('physics panel: tunables', () => tunablesAtom.get(), [])
  const legMode = useValue('physics panel: legMode', () => legModeAtom.get(), [])
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  if (!playing) return null

  const set = (key: keyof typeof tunables, value: number) => {
    tunablesAtom.set({ ...tunablesAtom.get(), [key]: value })
  }

  const reset = () => tunablesAtom.set(makeTunables())

  const copy = () => {
    // The full tunable set, formatted so it pastes straight into PHYSICS_DEFAULTS.
    const text = JSON.stringify(tunables, null, 2)
    void navigator.clipboard?.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="eng-physics">
      <div className="eng-physics-head">
        <span className="eng-physics-title">Physics</span>
        <button
          className="eng-physics-collapse"
          onClick={() => setOpen((o) => !o)}
          title={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▸'}
        </button>
      </div>

      {open && (
        <>
          <div className="eng-physics-body">
            <div className="eng-physics-group">
              <div className="eng-physics-group-title">Animation</div>
              <label className="eng-physics-row">
                <span className="eng-physics-lbl">Legs</span>
                <span className="eng-legmode">
                  <button
                    className={legMode === 'ik' ? 'eng-legmode-btn eng-legmode-on' : 'eng-legmode-btn'}
                    onClick={() => legModeAtom.set('ik')}
                    title="Bending-knee inverse kinematics: each foot plants at a world target"
                  >
                    IK
                  </button>
                  <button
                    className={legMode === 'straight' ? 'eng-legmode-btn eng-legmode-on' : 'eng-legmode-btn'}
                    onClick={() => legModeAtom.set('straight')}
                    title="Straight legs: the thighs swing, the knee stays inline"
                  >
                    Straight
                  </button>
                </span>
              </label>
            </div>
            {TUNABLE_GROUPS.map((group) => (
              <div className="eng-physics-group" key={group.title}>
                <div className="eng-physics-group-title">{group.title}</div>
                {group.specs.map((spec) => {
                  const value = tunables[spec.key]
                  const changed = value !== PHYSICS_DEFAULTS[spec.key]
                  return (
                    <label className="eng-physics-row" key={spec.key}>
                      <span className={changed ? 'eng-physics-lbl eng-changed' : 'eng-physics-lbl'}>
                        {spec.label}
                      </span>
                      <input
                        className="eng-physics-slider"
                        type="range"
                        min={spec.min}
                        max={spec.max}
                        step={spec.step}
                        value={value}
                        onChange={(e) => set(spec.key, e.target.valueAsNumber)}
                      />
                      <span className="eng-physics-val">{format(value, spec.step)}</span>
                    </label>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="eng-physics-actions">
            <button className="eng-physics-action" onClick={reset}>
              Reset
            </button>
            <button className="eng-physics-action" onClick={copy}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Show whole numbers plainly; sub-integer steps get two decimals. */
function format(value: number, step: number): string {
  return step >= 1 ? String(Math.round(value)) : value.toFixed(2)
}
