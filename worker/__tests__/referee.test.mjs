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
