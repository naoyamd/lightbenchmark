
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const BLOCK_ORDER=['medium','small','large'];
const FINGER_EXTENSION=.18;
let params,phase,index,dwell,verify,commands;
export function reset(config){params=config;phase='APPROACH';index=0;dwell=0;verify=0;commands=[0,0,0]}
function inverseArm(goal, params, current) {
  const [l1, l2, palmLength] = params.lengths;
  const phi = -Math.PI / 2;
  const wx = goal[0] - (palmLength + FINGER_EXTENSION) * Math.cos(phi) - params.base[0];
  const wy = goal[1] - (palmLength + FINGER_EXTENSION) * Math.sin(phi) - params.base[1];
  const cosine = (wx * wx + wy * wy - l1 * l1 - l2 * l2) / (2 * l1 * l2);
  if (cosine < -1 || cosine > 1) return null;
  const q2 = Math.acos(clamp(cosine, -1, 1));
  const candidates = [q2, -q2].map((elbowAngle) => {
    const q1 = Math.atan2(wy, wx) - Math.atan2(l2 * Math.sin(elbowAngle), l1 + l2 * Math.cos(elbowAngle));
    return [q1, elbowAngle, phi - q1 - elbowAngle];
  }).filter(candidate => candidate[0] >= 0 && candidate[0] <= Math.PI);
  if (!candidates.length) return null;
  return candidates.reduce((best, candidate) => {
    const travel = candidate.reduce((sum, value, index) => sum + Math.abs(value - current[index]), 0);
    const score = -100 * Math.sin(candidate[0]) + travel;
    return !best || score < best.score ? { candidate, score } : best;
  }, null).candidate;
}

function goalFor(phase, active, params, state) {
  if (!active) return [params.stackX, params.goalSlots.at(-1).y + 0.45];
  const block = state.blocks.find((item) => item.id === active.id);
  const slot = params.goalSlots.find((item) => item.id === active.id);
  const hover = 1.3;
  if (phase === 'RETURN') return [.3, 1.8];
  if (phase === 'APPROACH') return [block.x, Math.max(block.y + .3, .72)];
  if (phase === 'DESCEND' || phase === 'CLOSE') return [block.x, block.y];
  if (phase === 'LIFT') return [active.initial[0], hover];
  if (phase === 'CROSS') return [.3, 1.8];
  if (phase === 'ALIGN') return [params.stackX, hover];
  const order = BLOCK_ORDER.indexOf(active.id);
  const support = order ? state.blocks.find(b => b.id === BLOCK_ORDER[order - 1]) : null;
  const supportDef = order ? params.blocks.find(b => b.id === support.id) : null;
  const placeY = support ? support.y + supportDef.height / 2 + active.height / 2 + .015 : params.tableY + active.height / 2 + .015;
  if (phase === 'LOWER' || phase === 'OPEN') return [slot.x, placeY];
  return [slot.x, hover];
}


export function step(obs,dt){
 let active=params.blocks[index],goal=goalFor(phase,active,params,obs);
 const both=['finger-left','finger-right'].every(f=>obs.contacts.includes(['block-'+active.id,f].sort().join('|')));
 const touching=['finger-left','finger-right'].some(f=>obs.contacts.includes(['block-'+active.id,f].sort().join('|')));
 const tight=['DESCEND','CLOSE','LOWER','OPEN'].includes(phase);
 const near=Math.hypot(obs.tool[0]-goal[0],obs.tool[1]-goal[1])<(tight?.018:.045)&&Math.hypot(...obs.toolVelocity)<(tight?.09:.2)&&Math.abs(obs.palmAngle+Math.PI/2)<.06;
 if(phase==='VERIFY'){
   verify=obs.stackCount>=index+1&&near?verify+dt:0;
   if(verify>=(index===2?3:.55)&&index<2){index++;phase='RETURN';dwell=0;verify=0;}
 }else{
   const qualified=phase==='CLOSE'?both&&near:phase==='OPEN'?!touching:near;
   dwell=qualified?dwell+dt:0;
   if(dwell>=.2){const next={RETURN:'APPROACH',APPROACH:'DESCEND',DESCEND:'CLOSE',CLOSE:'LIFT',LIFT:'CROSS',CROSS:'ALIGN',ALIGN:'LOWER',LOWER:'OPEN',OPEN:'RETREAT',RETREAT:'VERIFY'}[phase];if(next){phase=next;dwell=0;}}
 }
 active=params.blocks[index];goal=goalFor(phase,active,params,obs);
 const desired=inverseArm(goal,params,obs.q)??obs.q;
 for(let i=0;i<3;i++){
   const limit=['DESCEND','CLOSE','LOWER','OPEN'].includes(phase)?.4:1.1;
   const speed=i===2?clamp(-obs.dq[0]-obs.dq[1]+10*(-Math.PI/2-obs.q.reduce((a,b)=>a+b,0)),-4,4):clamp([3.6,4.2][i]*(desired[i]-obs.q[i])-[.55,.65][i]*obs.dq[i],-limit,limit);
   const change=(i===2?10:1.4)*dt;commands[i]=clamp(speed,commands[i]-change,commands[i]+change);
 }
 return {jointSpeeds:commands,gripperOpening:['CLOSE','LIFT','CROSS','ALIGN','LOWER'].includes(phase)?active.width-.001:.544};
}
