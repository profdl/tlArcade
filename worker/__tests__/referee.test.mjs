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

// ── Phase 5: decks / shuffle / draw ───────────────────────────────────────────
stored['shape:deck1'] = { id: 'shape:deck1', type: 'container', props: { visibility: 'hidden', owner: null, count: 0, layout: 'stack' } }
const cards52 = Array.from({ length: 52 }, (_, i) => `card-${i}`)
await ref.handleRequest('sess1', 'seed1', { action: 'seedDeck', containerId: 'shape:deck1', values: cards52 })
console.log('seedDeck publishes count, NOT contents:', stored['shape:deck1'].props.count === 52, '| no card value in store:', !JSON.stringify(stored['shape:deck1']).includes('card-0'))

// shuffle then draw all 52 to the table → we must get all 52 distinct values, none lost/duped.
await ref.handleRequest('sess1', 'shuf1', { action: 'shuffle', containerId: 'shape:deck1' })
const drawn = new Set()
for (let i = 0; i < 52; i++) {
  stored[`shape:drawn${i}`] = { id: `shape:drawn${i}`, type: 'card', props: { state: 'faceDown', revealedValue: null, secretRef: null, owner: null } }
  await ref.handleRequest('sess1', `draw${i}`, { action: 'draw', containerId: 'shape:deck1', cardId: `shape:drawn${i}`, to: 'table' })
  drawn.add(stored[`shape:drawn${i}`].props.revealedValue)
}
console.log('drew all 52 distinct cards (shuffle preserves the multiset):', drawn.size === 52)
console.log('deck now empty:', stored['shape:deck1'].props.count === 0)
const overdraw = await ref.handleRequest('sess1', 'over', { action: 'draw', containerId: 'shape:deck1', cardId: 'shape:x', to: 'table' })
console.log('drawing from empty deck fails cleanly:', !overdraw.ok)

// owner-only draw: value goes to the seat privately, NOT into the store.
stored['shape:deck2'] = { id: 'shape:deck2', type: 'container', props: { visibility: 'ownerOnly', owner: 'seatA', count: 0, layout: 'fan' } }
await ref.handleRequest('sess1', 'seed2', { action: 'seedDeck', containerId: 'shape:deck2', values: ['HIDDEN-CARD'] })
sent.length = 0
stored['shape:hand1'] = { id: 'shape:hand1', type: 'card', props: { state: 'faceDown', revealedValue: null, secretRef: null, owner: null } }
await ref.handleRequest('sess1', 'drawHand', { action: 'draw', containerId: 'shape:deck2', cardId: 'shape:hand1', to: 'seatA' })
const handLeak = JSON.stringify(stored['shape:hand1']).includes('HIDDEN-CARD')
const handPush = sent.some(s => JSON.stringify(s.data).includes('HIDDEN-CARD'))
console.log('owner-only draw keeps value OUT of store:', !handLeak, '| pushes privately to owner:', handPush, '| card owner=seatA:', stored['shape:hand1'].props.owner === 'seatA')

// Authorization on deck actions (defense in depth):
// re-seeding an existing deck is rejected (no mid-game clobber).
const reseed = await ref.handleRequest('sess1', 'reseed', { action: 'seedDeck', containerId: 'shape:deck1', values: ['x'] })
console.log('cannot re-seed an existing deck:', !reseed.ok, '|', reseed.ok ? '' : reseed.error)

// drawing into ANOTHER seat's hand is rejected (sessX occupies no seat / not seatA).
stored['shape:deck3'] = { id: 'shape:deck3', type: 'container', props: { visibility: 'hidden', owner: null, count: 0, layout: 'stack' } }
await ref.handleRequest('sess1', 'seed3', { action: 'seedDeck', containerId: 'shape:deck3', values: ['a','b'] })
const drawOther = await ref.handleRequest('sessX', 'drawO', { action: 'draw', containerId: 'shape:deck3', cardId: 'shape:c', to: 'seatA' })
console.log('cannot draw into a seat you do not occupy:', !drawOther.ok, '|', drawOther.ok ? '' : drawOther.error)

// drawing to the TABLE is allowed for any player (public deal).
stored['shape:tc'] = { id: 'shape:tc', type: 'card', props: { state: 'faceDown', revealedValue: null, secretRef: null, owner: null } }
const drawTable = await ref.handleRequest('sessX', 'drawT', { action: 'draw', containerId: 'shape:deck3', cardId: 'shape:tc', to: 'table' })
console.log('any player may draw to the table:', drawTable.ok)

// Authorization: an OWNED deck (seatA's private pile) may not be drawn FROM by a
// non-owner, even to the table — prevents reading someone's private deck.
stored['shape:privdeck'] = { id: 'shape:privdeck', type: 'container', props: { visibility: 'ownerOnly', owner: 'seatA', count: 0, layout: 'stack' } }
await ref.handleRequest('sess1', 'seedPriv', { action: 'seedDeck', containerId: 'shape:privdeck', values: ['secret-card'] })
stored['shape:steal'] = { id: 'shape:steal', type: 'card', props: { state: 'faceDown', revealedValue: null, secretRef: null, owner: null } }
const stealToTable = await ref.handleRequest('sessX', 'steal', { action: 'draw', containerId: 'shape:privdeck', cardId: 'shape:steal', to: 'table' })
const stealLeak = JSON.stringify(stored['shape:steal']).includes('secret-card')
console.log('non-owner cannot draw a private deck to the table:', !stealToTable.ok, '| no value leaked to store:', !stealLeak)

// non-owner cannot shuffle someone's private deck either.
const stealShuffle = await ref.handleRequest('sessX', 'stealShuf', { action: 'shuffle', containerId: 'shape:privdeck' })
console.log('non-owner cannot shuffle a private deck:', !stealShuffle.ok)

// the owner (sess1 in seatA) CAN draw from their own private deck.
stored['shape:own'] = { id: 'shape:own', type: 'card', props: { state: 'faceDown', revealedValue: null, secretRef: null, owner: null } }
const ownDraw = await ref.handleRequest('sess1', 'ownDraw', { action: 'draw', containerId: 'shape:privdeck', cardId: 'shape:own', to: 'seatA' })
console.log('owner can draw from their own private deck:', ownDraw.ok)
