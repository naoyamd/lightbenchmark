const COLORS = { medium: '#e47d6b', small: '#7fb6df', large: '#e8c969' };
const LABELS = { medium: '中', small: '小', large: '大' };
const ORDER = ['medium', 'small', 'large'];
const PHASES = {
  APPROACH: '箱の上へ移動', DESCEND: '指を箱の横へ下ろす', CLOSE: '指を閉じてつかむ',
  GRIP: '指を閉じてつかむ', LIFT: '持ち上げる', CROSS: '仕切りを越えて運ぶ',
  RETURN: '次の箱へ戻る', ALIGN: '積む位置の上へ移動',
  TRANSFER: '仕切りを越えて運ぶ', LOWER: '中心を合わせて下ろす', PLACE: '中心を合わせて下ろす',
  OPEN: '指を開いて離す', RELEASE: '指を開いて離す', RETREAT: '手を離して退避',
  VERIFY: '3秒間の安定を確認', DONE: '中 → 小 → 大の積み上げ完了', FAILED: '動作を停止',
};
const fmt = (n, digits = 1) => Number.isFinite(n) ? n.toFixed(digits) : '—';

export function stackPhase(frame) {
  const phase = PHASES[frame.phase.toUpperCase()] ?? frame.phase;
  const index = ORDER.indexOf(frame.activeBlockId);
  return index >= 0 && !['VERIFY', 'DONE', 'FAILED'].includes(frame.phase.toUpperCase())
    ? `${index + 1} ${LABELS[frame.activeBlockId]}サイズ：${phase}` : phase;
}

/** A read-only view of simulated contacts and poses; nothing here changes physics. */
export function createStackScene(demo) {
  const p = demo.params;
  const definitions = new Map(p.blocks.map(block => [block.id, block]));
  const points = demo.frames.flatMap(frame => [
    ...frame.joints, [frame.palm.x, frame.palm.y],
    ...frame.blocks.map(b => [b.x, b.y]),
  ]);
  const minX = Math.min(-2, ...points.map(a => a[0])) - .25;
  const maxX = Math.max(1.9, ...points.map(a => a[0])) + .25;
  const maxY = Math.max(1.95, ...points.map(a => a[1])) + .25;
  const scale = Math.min(600 / (maxX - minX), 292 / maxY);
  const offsetX = (720 - (maxX - minX) * scale) / 2 - minX * scale;
  const px = x => offsetX + x * scale;
  const py = y => 350 - y * scale;

  function blockShape(block, active = false) {
    const def = definitions.get(block.id), w = def.width * scale, h = def.height * scale;
    const color = COLORS[block.id], number = ORDER.indexOf(block.id) + 1;
    return `<g transform="translate(${px(block.x)} ${py(block.y)}) rotate(${-block.angle * 180 / Math.PI})">
      <ellipse cx="4" cy="${h / 2 + 5}" rx="${w * .55}" ry="4" fill="#061f20" opacity=".22"/>
      <path d="M${-w/2} ${-h/2}l7 -6h${w}l-7 6Z" fill="${color}" stroke="#ededd7" stroke-opacity=".4"/>
      <path d="M${w/2} ${-h/2}l7 -6v${h}l-7 6Z" fill="${color}" stroke="#152c2a" stroke-opacity=".5"/>
      <rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="2" fill="${color}" stroke="#1a3833" stroke-width="1.5"/>
      ${active?`<rect x="${-w/2-3}" y="${-h/2-3}" width="${w+6}" height="${h+6}" rx="3" fill="none" stroke="#edfad0" stroke-opacity=".6"/>`:''}
      <text y="4" text-anchor="middle" fill="#25382d" font-family="sans-serif" font-size="${Math.min(16, h*.64)}" font-weight="700">${number}</text>
    </g>`;
  }

  function rectangle(body, fill, stroke = '#102c2b') {
    return `<rect x="${-body.width*scale/2}" y="${-body.height*scale/2}" width="${body.width*scale}" height="${body.height*scale}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.5" transform="translate(${px(body.x)} ${py(body.y)}) rotate(${-body.angle*180/Math.PI})"/>`;
  }

  return function draw(index) {
    const f = demo.frames[index], barrier = p.barrier;
    const goalX = px(p.stackX), tableY = py(p.tableY);
    const inputCenter = p.blocks.reduce((sum, b) => sum + b.initial[0], 0) / p.blocks.length;
    const goal = p.goalSlots.find(g => g.id === f.activeBlockId);
    const ghost = p.goalSlots.map((g, i) => {
      const active = g.id === f.activeBlockId, color = COLORS[g.id];
      return `<g opacity="${i < f.stackCount ? .23 : active ? 1 : .68}">
        <rect x="${px(g.x)-g.width*scale/2}" y="${py(g.y)-g.height*scale/2}" width="${g.width*scale}" height="${g.height*scale}" rx="2" fill="${color}" fill-opacity=".09" stroke="${color}" stroke-width="${active?2:1.5}" stroke-dasharray="4 4"/>
        <path d="M${px(g.x)+g.width*scale/2+9} ${py(g.y)}h21" stroke="${color}" stroke-opacity=".7"/>
        <text x="${px(g.x)+g.width*scale/2+35}" y="${py(g.y)+4}" fill="${color}" font-size="12">${i+1} ${LABELS[g.id]}</text>
      </g>`;
    }).join('');
    const links = f.joints.map((q, i) => `${i ? 'L' : 'M'}${px(q[0])} ${py(q[1])}`).join('');
    const currentBlock = definitions.get(f.activeBlockId);
    const handEnd = [f.palm.x + f.palm.width / 2 * Math.cos(f.palm.angle), f.palm.y + f.palm.width / 2 * Math.sin(f.palm.angle)];
    const phase = stackPhase(f);
    let insetY=192;
    const goalInset=p.goalSlots.map((g,i)=>{
      const w=g.width*155,h=g.height*155,y=insetY-h;
      insetY=y-3;
      return `<rect x="${615-w/2}" y="${y}" width="${w}" height="${h}" rx="2" fill="${COLORS[g.id]}" fill-opacity="${i < f.stackCount ? .65 : .15}" stroke="${COLORS[g.id]}" stroke-dasharray="4 3"/><text x="655" y="${y+h/2+4}" fill="${COLORS[g.id]}" font-size="12">${i+1} ${LABELS[g.id]}${i<f.stackCount?' ✓':''}</text>`;
    }).join('');
    return `<svg class="stack-svg" viewBox="0 0 720 408" role="img" aria-label="中サイズ、小サイズ、大サイズの順に箱を積むロボットアーム">
      <defs><pattern id="stack-floor" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#84b0a4" stroke-opacity=".08"/></pattern></defs>
      <rect x="0" y="0" width="720" height="408" fill="url(#stack-floor)"/>
      <text x="26" y="29" fill="#d3e3cb" font-size="15" font-weight="600">${phase}</text>
      <text x="693" y="28" text-anchor="end" fill="#aec8b9" font-size="12">${fmt(f.t)} / ${p.duration} 秒</text>
      <path d="M42 ${tableY+9}H681l-15 16H29Z" fill="#173b37"/><path d="M42 ${tableY}H681v9H42Z" fill="#668b79"/>
      <rect x="${px(inputCenter)-91}" y="${tableY-3}" width="182" height="7" rx="2" fill="#a3b89a"/>
      <text x="${px(inputCenter)}" y="${tableY+43}" text-anchor="middle" fill="#a9c6b3" font-size="12">入力トレー</text>
      <rect x="${goalX-48}" y="${tableY-3}" width="96" height="7" rx="2" fill="#a9ca75"/>
      <text x="${goalX}" y="${tableY+43}" text-anchor="middle" fill="#d5e8a2" font-size="12">完成位置</text>
      <path d="M${goalX} ${tableY-120}V${tableY}" stroke="#dce9b2" stroke-opacity=".32" stroke-dasharray="3 6"/>
      ${ghost}
      ${rectangle({x:barrier.x,y:barrier.y+barrier.height/2,width:barrier.width,height:barrier.height,angle:0},f.contacts.some(c=>c.includes('barrier'))?'#c67a66':'#5d8073')}
      <text x="${px(barrier.x)}" y="${py(barrier.y+barrier.height)-9}" text-anchor="middle" fill="#9cbdad" font-size="11">仕切り</text>
      ${goal?`<circle cx="${px(goal.x)}" cy="${py(goal.y)}" r="5" fill="none" stroke="#ddecaa" stroke-width="1.5"/>`:''}
      <rect x="${px(p.base[0])-20}" y="${py(p.base[1])-3}" width="40" height="${Math.max(12,tableY-py(p.base[1]))}" rx="5" fill="#516f60"/>
      <path d="${links}" fill="none" stroke="#0d2727" stroke-width="22" stroke-linejoin="round"/>
      <path d="${links}" fill="none" stroke="#d7e1c8" stroke-width="15" stroke-linejoin="round"/>
      <path d="${links}" fill="none" stroke="#aebf9f" stroke-width="3" stroke-linejoin="round"/>
      ${f.joints.map((q,i)=>`<circle cx="${px(q[0])}" cy="${py(q[1])}" r="${i===0?12:9}" fill="#708f70" stroke="#25443a" stroke-width="3"/><circle cx="${px(q[0])}" cy="${py(q[1])}" r="3" fill="#dbe7c9"/>`).join('')}
      ${rectangle(f.palm,'#cbdcc1')}
      ${f.fingers.map(finger=>`<path d="M${px(handEnd[0])} ${py(handEnd[1])}L${px(finger.x)} ${py(finger.y)}" stroke="#95b899" stroke-width="3" fill="none"/>`).join('')}
      ${f.fingers.map((finger,i)=>rectangle(finger,f.contacts.some(c=>c.includes(i===0?'finger-left':'finger-right')&&c.includes('block-'))?'#b8eaa3':'#d5e6c7')).join('')}
      ${f.blocks.map(b=>blockShape(b,b.id===f.activeBlockId&&f.phase!=='DONE')).join('')}
      <g><rect x="556" y="51" width="139" height="151" rx="8" fill="#193d35" stroke="#52715b" stroke-opacity=".6"/><text x="570" y="72" fill="#d9e7ba" font-size="12">完成形（目標）</text>${goalInset}</g>
      ${currentBlock?`<text x="26" y="385" fill="#bdd4bc" font-size="12">${LABELS[currentBlock.id]}サイズ ${fmt(currentBlock.width*100,0)}×${fmt(currentBlock.height*100,0)} cm　指の開き ${fmt(f.gripperOpening*100,1)} cm</text>`:''}
      <text x="693" y="385" text-anchor="end" fill="#d7e8a4" font-size="13">${f.stackCount}/3 段　安定 ${fmt(f.stableSeconds)}/3.0 秒</text>
    </svg>`;
  };
}
