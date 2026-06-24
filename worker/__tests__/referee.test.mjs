import { Referee } from '../Referee.ts'

let stored = { 'shape:die1': { id: 'shape:die1', type: 'die', props: { faceCount: 20, value: 0, rolling: false } } }
const sent = []
const bridge = {
  updateStore: (fn) => fn({
    get: (id) => stored[id],
    put: (r) => { stored[r.id] = r },
    delete: (id) => { delete stored[id] },
  }),
  getRecord: (id) => stored[id],
  sendToSession: (sid, data) => sent.push({ sid, data }),
}
const ref = new Referee(bridge)

const r1 = await ref.handleRequest('sess1', 'req1', { action: 'claimSeat', seatId: 'seatA', identity: { kind: 'guest', guestId: 'g1', secret: 's1' } })
console.log('claimSeat ok:', r1.ok, JSON.stringify(r1.result))

const seen = new Set()
let bad = false
for (let i = 0; i < 200; i++) {
  const r = await ref.handleRequest('sess1', 'roll' + i, { action: 'roll', dieId: 'shape:die1' })
  if (!r.ok) { console.log('ROLL FAILED', r.error); bad = true; break }
  const v = r.result.value
  if (v < 0 || v > 19) { console.log('OUT OF RANGE', v); bad = true; break }
  seen.add(v)
}
if (!bad) console.log('distinct d20 values over 200 rolls:', seen.size, '(expect ~20)')
console.log('final stored die value/rolling:', stored['shape:die1'].props.value, '/', stored['shape:die1'].props.rolling)

const r3 = await ref.handleRequest('sess1', 'req1', { action: 'claimSeat', seatId: 'seatA', identity: { kind: 'guest', guestId: 'g1', secret: 's1' } })
console.log('idempotent replay ok:', r3.ok)

const r4 = await ref.handleRequest('sess2', 'req4', { action: 'claimSeat', seatId: 'seatA', identity: { kind: 'guest', guestId: 'OTHER', secret: 'x' } })
console.log('seat-taken rejected:', !r4.ok, '|', r4.ok ? '' : r4.error)

const r5 = await ref.handleRequest('sess1', 'req5', { action: 'shuffle', containerId: 'c1' })
console.log('unimplemented action fails cleanly:', !r5.ok, '|', r5.ok ? '' : r5.error)

// ── Phase 3: secrets / reveals ────────────────────────────────────────────────
stored['shape:card1'] = { id: 'shape:card1', type: 'card', props: { state: 'faceDown', revealedValue: null, secretRef: null, owner: null } }
stored['shape:card2'] = { id: 'shape:card2', type: 'card', props: { state: 'faceDown', revealedValue: null, secretRef: null, owner: null } }

// stashSecret: value must NOT enter the store; only an opaque ref does.
await ref.handleRequest('sess1', 'rs1', { action: 'stashSecret', cardId: 'shape:card1', value: 'Ace of Spades' })
const c1 = stored['shape:card1'].props
const leaked = JSON.stringify(c1).includes('Ace of Spades')
console.log('stashSecret keeps value OUT of store:', !leaked, '| secretRef set:', !!c1.secretRef, '| revealedValue null:', c1.revealedValue === null)

// reveal to table: value becomes public in the store.
await ref.handleRequest('sess1', 'rv1', { action: 'reveal', cardId: 'shape:card1', to: 'table' })
console.log('reveal-to-table makes value public:', stored['shape:card1'].props.revealedValue === 'Ace of Spades', '| faceUp:', stored['shape:card1'].props.state === 'faceUp')

// owner-only: stash with owner=seatA → private push to sess1, store stays redacted.
sent.length = 0
await ref.handleRequest('sess1', 'rs2', { action: 'stashSecret', cardId: 'shape:card2', value: 'King of Hearts', owner: 'seatA' })
const c2 = stored['shape:card2'].props
const leaked2 = JSON.stringify(c2).includes('King of Hearts')
const pushed = sent.find(s => s.sid === 'sess1' && JSON.stringify(s.data).includes('King of Hearts'))
console.log('owner-only keeps value OUT of store:', !leaked2, '| owner=seatA recorded:', c2.owner === 'seatA')
console.log('owner-only pushes privately to occupant session:', !!pushed)

// a NON-owner reveal request to seatB (no occupants) pushes to nobody.
sent.length = 0
const rvB = await ref.handleRequest('sess1', 'rvB', { action: 'reveal', cardId: 'shape:card2', to: 'seatB' })
console.log('reveal to empty seat ok but reaches nobody:', rvB.ok, '| sent count:', sent.length)

// reveal a card with no secret → clean failure.
const rvNone = await ref.handleRequest('sess1', 'rvNone', { action: 'reveal', cardId: 'shape:nope', to: 'table' })
console.log('reveal with no secret fails cleanly:', !rvNone.ok, '|', rvNone.ok ? '' : rvNone.error)

// Regression (security): the HTTP RESPONSE for a single-seat reveal must NOT
// carry the value — it goes to the unauthenticated POST caller, not only the
// seat owner. Delivery happens solely via the gated private push.
stored['shape:card3'] = { id: 'shape:card3', type: 'card', props: { state: 'faceDown', revealedValue: null, secretRef: null, owner: null } }
await ref.handleRequest('sess1', 'rs3', { action: 'stashSecret', cardId: 'shape:card3', value: 'SECRET-X', owner: 'seatA' })
const rvSeat = await ref.handleRequest('sessX', 'rvSeat', { action: 'reveal', cardId: 'shape:card3', to: 'seatA' })
const responseLeaks = JSON.stringify(rvSeat).includes('SECRET-X')
console.log('single-seat reveal response does NOT leak value:', !responseLeaks)

// Authorization (defense in depth): a session NOT in seatA cannot stash a secret
// owned by seatA, nor reveal seatA's owned card.
stored['shape:card4'] = { id: 'shape:card4', type: 'card', props: { state: 'faceDown', revealedValue: null, secretRef: null, owner: null } }
const stashOther = await ref.handleRequest('sessX', 'soX', { action: 'stashSecret', cardId: 'shape:card4', value: 'V', owner: 'seatA' })
console.log('cannot assign secret to a seat you do not occupy:', !stashOther.ok, '|', stashOther.ok ? '' : stashOther.error)

// card2 is owned by seatA (stashed earlier by sess1). sessX (no seat) cannot reveal it.
const revealOther = await ref.handleRequest('sessX', 'roX', { action: 'reveal', cardId: 'shape:card2', to: 'table' })
console.log('cannot reveal a card owned by another seat:', !revealOther.ok, '|', revealOther.ok ? '' : revealOther.error)

// the owner (sess1 in seatA) CAN reveal its own card.
const revealOwn = await ref.handleRequest('sess1', 'roOwn', { action: 'reveal', cardId: 'shape:card2', to: 'table' })
console.log('owner can reveal own card:', revealOwn.ok)
