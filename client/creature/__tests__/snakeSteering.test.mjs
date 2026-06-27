import { angleDelta, desiredHeading, easeHeading } from '../snakeSteering.ts'

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps
const arena = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }

// angleDelta: shortest signed difference, wrapping past ±π.
console.log('angleDelta(0, π/2) = π/2:', near(angleDelta(0, Math.PI / 2), Math.PI / 2))
console.log('angleDelta wraps the long way round (0.1 → 2π-0.1 = -0.2):',
  near(angleDelta(0.1, Math.PI * 2 - 0.1), -0.2, 1e-9))

// Centre of the arena, far from every edge → desired heading == wander (free roam).
console.log('centre → free roam (desired == wander):',
  near(desiredHeading({ x: 500, y: 500 }, 1.234, arena), 1.234))

// Near the LEFT edge while heading left (π) → desired heading bends toward +x (rightward,
// i.e. away from the edge), so it should pull off π toward 0.
const leftDesired = desiredHeading({ x: 20, y: 500 }, Math.PI, arena)
console.log('near left edge heading left → steers back inward (|desired| < π):',
  Math.abs(leftDesired) < Math.PI - 1e-3)

// Near the TOP edge → push is downward (+y), so desired heading tilts toward +π/2.
const topDesired = desiredHeading({ x: 500, y: 10 }, 0, arena)
console.log('near top edge → desired tilts downward (toward +y):', topDesired > 0)

// easeHeading respects the per-ms turn cap: a huge desired turn is clamped to maxTurn*dt.
const eased = easeHeading(0, Math.PI, 0.004, 16) // wants π, cap = 0.064 rad
console.log('easeHeading caps the turn at maxTurn*dt:', near(eased, 0.064))

// And it eases the RIGHT direction for a small turn (no clamp).
console.log('easeHeading takes a small turn directly:',
  near(easeHeading(1.0, 1.02, 0.004, 16), 1.02))
