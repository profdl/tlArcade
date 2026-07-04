// tuning.mjs — EVERY tunable number lives here, nowhere else.
// This is the dial board. Balancing the game = editing this file and re-running
// the balance harness. Keep all magic numbers here so a tuning pass is one file.

export const TUNING = {
  // --- board ---
  board: { w: 1200, h: 800 },
  // goal zones: a band on each side. owner A defends/scores left, B right.
  // (a creature reaching the OPPONENT's far edge is "captured" by that owner —
  //  i.e. you pull creatures toward your own goal.)
  goal: { width: 140 }, // px-deep band at each end

  // --- emitter kinds: base field strength multiplier ---
  baseStrength: { current: 1.0, vortex: 0.7, heat: 0.0 },
  // radius of influence (px) per kind
  radius: { current: 260, vortex: 200, heat: 180 },
  vortexCurl: 1.4, // how swirly a vortex is (tangential strength)

  // --- combo / dependency-graph wiring rules ---
  comboRange: 220, // px: emitters within this distance "wire together"
  combo: {
    vortexWidenCurrent: 0.7, // friendly vortex WIDENS adjacent current radius up to +70% (coverage — the combo's real payoff)
    vortexAmpCurrent: 0.35, // friendly vortex also amplifies adjacent current up to +35% (secondary)
    heatBend: 0.8, // friendly heat bends a current's angle up to 80% toward it (heat's whole identity: cheap steering)
    currentMerge: 0.55, // agreeing friendly currents merge: up to +55%
    mergeAgreeThreshold: 0.5, // cos(angle diff) must exceed this to merge
    currentCancel: 0.8, // opposing currents cancel up to 80% where head-on
    vortexScatter: 0.9, // enemy vortex scatters a current up to -90%
  },

  turbulenceNorm: 6, // divides summed vortex strength -> 0..1 turbulence uniform

  // --- economy ---
  economy: {
    startEnergy: 40,
    maxEnergy: 100,
    // regen must SUSTAIN a focused ~3-emitter build but NOT a 6-emitter carpet.
    // (3 currents drain 12/s; regen 13 sustains it. 5 currents drain 20/s -> brown out.)
    regenPerSec: 13, // regenerating pool (recommended model)
    // cost to PLACE an emitter (one-time) + DRAIN per second while active
    placeCost: { current: 12, vortex: 16, heat: 6 },
    drainPerSec: { current: 4, vortex: 5, heat: 2 },
    maxEmittersPerPlayer: 5, // hard cap so the field can't be carpeted
  },

  // --- creatures ---
  creatures: {
    count: 40, // particles in play at once
    spawnBand: 0.25, // fraction of board height around center they spawn in (tighter = less random edge-drift)
    speed: 22, // px/sec free-swim speed (low: the FIELD should dominate, not wander)
    fieldGain: 26, // how hard the field pushes them (force -> velocity). Field >> wander.
    wander: 0.18, // 0..1 random heading jitter (keeps it lively, doesn't decide outcomes)
    drag: 0.9, // velocity retention per tick (0..1)
    maxSpeed: 150, // px/sec cap
  },

  // --- match ---
  match: {
    tickHz: 30, // simulation ticks per second
    maxSeconds: 90, // round length
    captureGoal: 18, // first owner to capture this many creatures wins early
  },
}
