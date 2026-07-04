import { makeGrid } from '../geometry.ts'
const sq = makeGrid('square', 40)
const c = sq.cellCenter(0,0)
console.log('square cell(0,0) center = (20,20):', c.x===20 && c.y===20)
console.log('square snap(5,5) → (20,20):', (()=>{const s=sq.snap({x:5,y:5});return s.x===20&&s.y===20})())
console.log('square snap(38,79) → (20,60):', (()=>{const s=sq.snap({x:38,y:79});return s.x===20&&s.y===60})())
for (const type of ['hexFlat','hexPointy']) {
  const g = makeGrid(type, 30)
  let ok = true
  for (let q=-3;q<=3;q++) for (let r=-3;r<=3;r++){
    const ctr = g.cellCenter(q,r); const sn = g.snap(ctr)
    if (Math.abs(sn.x-ctr.x)>1e-6 || Math.abs(sn.y-ctr.y)>1e-6) ok=false
  }
  console.log(`${type}: snapping a cell centre is idempotent (49 cells):`, ok)
  const ctr = g.cellCenter(1,1); const near = g.snap({x:ctr.x+3,y:ctr.y-3})
  console.log(`${type}: near-centre snaps back:`, Math.abs(near.x-ctr.x)<1e-6 && Math.abs(near.y-ctr.y)<1e-6)
}
