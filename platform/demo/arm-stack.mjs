import * as pl from '../vendor/planck.mjs';

/**
 * Physical three-box stack reference.
 *
 * This uses Planck's rigid-body contact solver for the links, two prismatic
 * fingers, boxes, desk, and barrier.  The motors receive measured joint state
 * and only set bounded motor speeds; boxes are never welded, teleported, or
 * assigned a success position.  The controller is a reference, not an AI
 * score.  Contact/friction and the simple rectangular gripper are deliberately
 * small enough to run as a browser demo.
 */

const DT = 0.005;
const SAMPLE_EVERY = 10;
const GRAVITY = -9.81;
const Dwell = 0.2;
const STABLE_REQUIRED = 3;
const FINGER_WIDTH = 0.036;
const FINGER_HEIGHT = 0.1;
const INITIAL_JAW_OPENING = 0.58;
const FINGER_EXTENSION = 0.18;
const JAW_CLEARANCE = 0.035;
const GRIP_FRICTION = 1.5;
const ARM_DENSITY = 2.5;
const ARM_FRICTION = 0.7;
const BLOCK_FRICTION = 1.0;
const TORQUE_LIMITS = [90, 80, 45];
const JAW_FORCE_LIMIT = 12;
const FILTER = { table: 1, arm: 2, finger: 4, block: 8 };
const BLOCK_ORDER = ['medium', 'small', 'large'];
const BLOCK_SHAPES = {
  medium: { label: '中', width: 0.28, height: 0.22, mass: 0.55, color: '#e25f60', order: 1 },
  small: { label: '小', width: 0.19, height: 0.16, mass: 0.35, color: '#4f8bd8', order: 2 },
  large: { label: '大', width: 0.38, height: 0.26, mass: 0.85, color: '#e4b74f', order: 3 },
};
const CONTROLLERS = [
  { kp: [3.6, 4.2], kd: [0.55, 0.65] },
  { kp: [2.6, 3.0], kd: [0.2, 0.25] },
  { kp: [5.5, 6.2], kd: [0.08, 0.1] },
];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const v = (x, y) => pl.Vec2(x, y);
const point = (p) => [p.x, p.y];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const finite = (values) => values.flat(Infinity).every(Number.isFinite);

function rng(seed) {
  let state = (Number.isFinite(Number(seed)) ? Number(seed) : 1) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function shuffled(values, random) {
  const output = values.slice();
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function makeParams(seed) {
  const random = rng(seed);
  const tableY = 0.25;
  const stackX = 1.5;
  const xs = shuffled([-0.8, -0.25, 0.3], random);
  const blocks = BLOCK_ORDER.map((id, index) => {
    const shape = BLOCK_SHAPES[id];
    return {
      id,
      label: shape.label,
      order: shape.order,
      width: shape.width,
      height: shape.height,
      mass: shape.mass,
      color: shape.color,
      initial: [xs[index], tableY + shape.height / 2],
    };
  });
  const medium = BLOCK_SHAPES.medium;
  const small = BLOCK_SHAPES.small;
  const large = BLOCK_SHAPES.large;
  const goalSlots = [
    // The visual goal includes Planck's 0.01m polygon skins on both contact faces.
    { id: 'medium', x: stackX, y: tableY + medium.height / 2 + .02, width: medium.width, height: medium.height },
    { id: 'small', x: stackX, y: tableY + medium.height + small.height / 2 + .04, width: small.width, height: small.height },
    { id: 'large', x: stackX, y: tableY + medium.height + small.height + large.height / 2 + .06, width: large.width, height: large.height },
  ];
  return {
    seed: Number.isFinite(Number(seed)) ? Number(seed) : 1,
    base: [-1.8, 0.4],
    lengths: [1.9, 1.85, 0.26],
    tableY,
    stackX,
    barrier: { x: 0.75, y: tableY, width: 0.16, height: 0.42 },
    blocks,
    goalSlots,
    duration: 65,
  };
}

function body(world, position, angle, width, height, density, friction, tag, options = {}) {
  const result = world.createDynamicBody({
    position: v(position[0], position[1]),
    angle,
    bullet: options.bullet !== false,
    linearDamping: options.linearDamping ?? 0.08,
    angularDamping: options.angularDamping ?? 0.12,
    allowSleep: false,
    userData: tag,
  });
  const fixture = result.createFixture(pl.Box(width / 2, height / 2), {
    density,
    friction,
    restitution: 0,
    filterCategoryBits: options.category ?? FILTER.arm,
    filterMaskBits: options.mask ?? (FILTER.table | FILTER.block),
    userData: tag,
  });
  fixture.setUserData(tag);
  return result;
}

function staticBox(world, position, width, height, tag) {
  const result = world.createBody({ position: v(position[0], position[1]), userData: tag });
  const fixture = result.createFixture(pl.Box(width / 2, height / 2), {
    friction: 1,
    filterCategoryBits: FILTER.table,
    filterMaskBits: FILTER.arm | FILTER.finger | FILTER.block,
    userData: tag,
  });
  fixture.setUserData(tag);
  return result;
}

function addJoint(world, Joint, def) {
  return world.createJoint(Joint(def));
}

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

function contactTags(contact) {
  return [contact.getFixtureA().getUserData(), contact.getFixtureB().getUserData()]
    .filter((tag) => typeof tag === 'string');
}

function hasPair(contacts, a, b) {
  return contacts.has(pairKey(a, b));
}

function createWorld(params) {
  const world = new pl.World(v(0, GRAVITY));
  const contacts = new Set();
  let collisions = 0;
  world.on('begin-contact', (contact) => {
    const tags = contactTags(contact);
    if (tags.length !== 2) return;
    contacts.add(pairKey(tags[0], tags[1]));
    if (tags.some((tag) => tag === 'barrier') && tags.some((tag) => tag.startsWith('arm-') || tag.startsWith('finger-') || tag.startsWith('block-'))) collisions += 1;
  });
  world.on('end-contact', (contact) => {
    const tags = contactTags(contact);
    if (tags.length === 2) contacts.delete(pairKey(tags[0], tags[1]));
  });

  const table = staticBox(world, [0, params.tableY - 0.08], 5.2, 0.16, 'table');
  staticBox(world, [params.barrier.x, params.barrier.y + params.barrier.height / 2], params.barrier.width, params.barrier.height, 'barrier');
  const ground = world.createBody({ position: v(params.base[0], params.base[1]), userData: 'arm-base' });
  const [l1, l2, palmLength] = params.lengths;
  const q0 = [0.95, -0.25, -Math.PI / 2 - 0.7];
  const elbow = [params.base[0] + l1 * Math.cos(q0[0]), params.base[1] + l1 * Math.sin(q0[0])];
  const wrist = [elbow[0] + l2 * Math.cos(q0[0] + q0[1]), elbow[1] + l2 * Math.sin(q0[0] + q0[1])];
  const palmAngle = q0[0] + q0[1] + q0[2];
  const palmCenter = [wrist[0] + palmLength / 2 * Math.cos(palmAngle), wrist[1] + palmLength / 2 * Math.sin(palmAngle)];
  const armOptions = { category: FILTER.arm, mask: FILTER.table | FILTER.block };
  const link1 = body(world, [params.base[0] + l1 / 2 * Math.cos(q0[0]), params.base[1] + l1 / 2 * Math.sin(q0[0])], q0[0], l1, 0.11, ARM_DENSITY, ARM_FRICTION, 'arm-link1', armOptions);
  const link2 = body(world, [elbow[0] + l2 / 2 * Math.cos(q0[0] + q0[1]), elbow[1] + l2 / 2 * Math.sin(q0[0] + q0[1])], q0[0] + q0[1], l2, 0.1, ARM_DENSITY, ARM_FRICTION, 'arm-link2', armOptions);
  const palm = body(world, palmCenter, palmAngle, palmLength, 0.09, ARM_DENSITY, ARM_FRICTION, 'arm-palm', armOptions);
  const joints = [
    addJoint(world, pl.RevoluteJoint, { bodyA: ground, bodyB: link1, localAnchorA: v(0, 0), localAnchorB: v(-l1 / 2, 0), referenceAngle: 0, enableMotor: true, maxMotorTorque: TORQUE_LIMITS[0] }),
    addJoint(world, pl.RevoluteJoint, { bodyA: link1, bodyB: link2, localAnchorA: v(l1 / 2, 0), localAnchorB: v(-l2 / 2, 0), referenceAngle: 0, enableMotor: true, maxMotorTorque: TORQUE_LIMITS[1] }),
    addJoint(world, pl.RevoluteJoint, { bodyA: link2, bodyB: palm, localAnchorA: v(l2 / 2, 0), localAnchorB: v(-palmLength / 2, 0), referenceAngle: 0, enableMotor: true, maxMotorTorque: TORQUE_LIMITS[2] }),
  ];
  const fingerOffsets = [-INITIAL_JAW_OPENING / 2, INITIAL_JAW_OPENING / 2];
  const fingers = fingerOffsets.map((offset, index) => {
    const fingerPosition = point(palm.getWorldPoint(v(palmLength / 2 + FINGER_EXTENSION, offset)));
    const tag = index === 0 ? 'finger-left' : 'finger-right';
    const finger = body(world, fingerPosition, palmAngle, FINGER_HEIGHT, FINGER_WIDTH, 3, GRIP_FRICTION, tag, { category: FILTER.finger, mask: FILTER.table | FILTER.block });
    const joint = addJoint(world, pl.PrismaticJoint, {
      bodyA: palm,
      bodyB: finger,
      localAnchorA: v(palmLength / 2 + FINGER_EXTENSION, offset),
      localAnchorB: v(0, 0),
      localAxisA: v(0, 1),
      lowerTranslation: -0.3,
      upperTranslation: 0.3,
      enableLimit: true,
      enableMotor: true,
      maxMotorForce: JAW_FORCE_LIMIT,
    });
    return { body: finger, joint, side: offset < 0 ? -1 : 1, initialOffset: offset, tag };
  });
  const blockBodies = new Map();
  for (const spec of params.blocks) {
    const b = body(world, spec.initial, 0, spec.width, spec.height, spec.mass / (spec.width * spec.height), BLOCK_FRICTION, `block-${spec.id}`, { linearDamping: 0.05, angularDamping: 0.08, category: FILTER.block, mask: FILTER.table | FILTER.arm | FILTER.finger | FILTER.block });
    blockBodies.set(spec.id, b);
  }
  return { world, contacts, getCollisions: () => collisions, table, ground, link1, link2, palm, joints, fingers, blockBodies, commands: [0, 0, 0] };
}

function bodyPoint(bodyRef, localX, localY = 0) {
  return point(bodyRef.getWorldPoint(v(localX, localY)));
}

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

function motorControl(sim, params, model, phase, active, goal, q, dq, close) {
  const tuning = CONTROLLERS[model];
  const desired = inverseArm(goal, params, q) ?? q;
  for (let index = 0; index < sim.joints.length; index += 1) {
    const error = desired[index] - q[index];
    const limit = ['DESCEND','CLOSE','LOWER','OPEN'].includes(phase) ? .4 : 1.1;
    const desiredSpeed = index === 2
      ? clamp(-dq[0] - dq[1] + 10 * (-Math.PI / 2 - q.reduce((a,b)=>a+b,0)), -4, 4)
      : clamp(tuning.kp[index] * error - tuning.kd[index] * dq[index], -limit, limit);
    const maxChange = (index === 2 ? 10 : 1.4) * DT;
    sim.commands[index] = clamp(desiredSpeed, sim.commands[index] - maxChange, sim.commands[index] + maxChange);
    sim.joints[index].setMotorSpeed(sim.commands[index]);
    sim.joints[index].setMaxMotorTorque(TORQUE_LIMITS[index]);
  }
  const activeWidth = active?.width ?? BLOCK_SHAPES.medium.width;
  const opening = close ? activeWidth + JAW_CLEARANCE : INITIAL_JAW_OPENING;
  for (const finger of sim.fingers) {
    const desiredOffset = finger.side * opening / 2;
    const currentOffset = finger.initialOffset + finger.joint.getJointTranslation();
    finger.joint.setMotorSpeed(clamp(5 * (desiredOffset - currentOffset), -.14, .14));
    finger.joint.setMaxMotorForce(JAW_FORCE_LIMIT);
  }
}

function stateSnapshot(sim, params, phase, active, stackCount, stableSeconds, goal, holding, motorTorque, jawForce, contacts) {
  const joints = [params.base, bodyPoint(sim.link1, params.lengths[0] / 2), bodyPoint(sim.link2, params.lengths[1] / 2)];
  const palmPosition = point(sim.palm.getPosition());
  const palmAngle = sim.palm.getAngle();
  const palmEnd = bodyPoint(sim.palm, params.lengths[2] / 2 + FINGER_EXTENSION);
  const fingers = sim.fingers.map((finger) => ({
    x: finger.body.getPosition().x,
    y: finger.body.getPosition().y,
    angle: finger.body.getAngle(),
    width: FINGER_HEIGHT,
    height: FINGER_WIDTH,
  }));
  const blocks = params.blocks.map((spec) => {
    const position = sim.blockBodies.get(spec.id).getPosition();
    return { id: spec.id, x: position.x, y: position.y, angle: sim.blockBodies.get(spec.id).getAngle() };
  });
  return {
    t: 0,
    joints: joints.map((item) => item.slice()),
    palm: { x: palmPosition[0], y: palmPosition[1], angle: palmAngle, width: params.lengths[2], height: 0.09 },
    fingers,
    blocks,
    goal: goal.slice(),
    phase,
    activeBlockId: active?.id ?? null,
    holding,
    stackCount,
    stableSeconds,
    gripperOpening: Math.max(0, Math.hypot(fingers[0].x - fingers[1].x, fingers[0].y - fingers[1].y) - FINGER_WIDTH),
    contacts: [...contacts].sort(),
    motorTorque: motorTorque.slice(),
    jawForce: jawForce.slice(),
    tool: palmEnd,
  };
}

function blockStable(bodyRef) {
  const velocity = bodyRef.getLinearVelocity();
  return Math.hypot(velocity.x, velocity.y) < 0.12 && Math.abs(bodyRef.getAngularVelocity()) < 0.2;
}

function stackCount(sim, params, contacts) {
  let count = 0;
  for (let index = 0; index < params.goalSlots.length; index += 1) {
    const slot = params.goalSlots[index];
    const bodyRef = sim.blockBodies.get(slot.id);
    const position = bodyRef.getPosition();
    const angle = bodyRef.getAngle();
    const near = Math.abs(position.x - slot.x) < 0.06 && Math.abs(position.y - slot.y) < 0.09 && Math.abs(angle) < 0.10 && blockStable(bodyRef);
    const support = index === 0
      ? hasPair(contacts, `block-${slot.id}`, 'table')
      : hasPair(contacts, `block-${slot.id}`, `block-${params.goalSlots[index - 1].id}`);
    const handFree = !hasPair(contacts, 'finger-left', `block-${slot.id}`) && !hasPair(contacts, 'finger-right', `block-${slot.id}`);
    if (!near || !support || !handFree) break;
    count += 1;
  }
  return count;
}

function contactForBlock(contacts, id) {
  return hasPair(contacts, 'finger-left', `block-${id}`)
    && hasPair(contacts, 'finger-right', `block-${id}`);
}

/**
 * Simulate the physical MEDIUM -> SMALL -> LARGE stack.
 * options.unforced is a plant diagnostic; normal runs use one of three
 * feedback references.  No body transform or grasp weld is used.
 */
export function createStackDemo(seed = 1, model = 0, options = {}) {
  const params = makeParams(seed);
  if (options.dropTest) for (const block of params.blocks) block.initial[1] += .5;
  const sim = createWorld(params);
  const ticks = Math.round(params.duration / DT);
  const modelIndex = clamp(Math.trunc(Number(model) || 0), 0, 2);
  let phase = 'APPROACH', activeIndex = 0, releasedCount = 0;
  let dwell = 0, verifyTime = 0, lossTime = 0, grasped = false;
  let completionTime = null, success = false, failedReason = null, drops = 0, effort = 0;
  const frames = [];
  if (options.unforced) {
    for (const joint of sim.joints) joint.enableMotor(false);
    for (const finger of sim.fingers) finger.joint.enableMotor(false);
  }
  for (let tick = 0; tick <= ticks; tick++) {
    const t = tick * DT;
    let active = params.blocks.find(b => b.id === BLOCK_ORDER[activeIndex]);
    let state = stateSnapshot(sim, params, phase, active, 0, 0, [0,0], false, [0,0,0], [0,0], sim.contacts);
    let goal = goalFor(phase, active, params, state);
    const toolVelocity = sim.palm.getLinearVelocityFromWorldPoint(v(...state.tool));
    const speed = Math.hypot(toolVelocity.x, toolVelocity.y);
    const both = contactForBlock(sim.contacts, active.id);
    const touching = hasPair(sim.contacts,'finger-left',`block-${active.id}`) || hasPair(sim.contacts,'finger-right',`block-${active.id}`);
    const tight = ['DESCEND','CLOSE','LOWER','OPEN'].includes(phase);
    const near = distance(state.tool, goal) < (tight ? .018 : .045) && speed < (tight ? .09 : .2)
      && Math.abs(sim.palm.getAngle() + Math.PI/2) < .06;
    const currentStack = stackCount(sim,params,sim.contacts);
    if (!options.unforced) {
      if (phase === 'VERIFY') {
        verifyTime = currentStack >= releasedCount && near ? verifyTime + DT : 0;
        if (verifyTime >= (activeIndex === 2 ? STABLE_REQUIRED : .55)) {
          if (activeIndex === 2) {success=true;completionTime=t;phase='DONE';}
          else {activeIndex++;phase='RETURN';dwell=0;verifyTime=0;grasped=false;}
        }
      } else {
        const qualified = phase==='CLOSE' ? both && near : phase==='OPEN' ? !touching : near;
        dwell = qualified ? dwell + DT : 0;
        if (dwell >= Dwell) {
          const next = {RETURN:'APPROACH',APPROACH:'DESCEND',DESCEND:'CLOSE',CLOSE:'LIFT',LIFT:'CROSS',CROSS:'ALIGN',ALIGN:'LOWER',LOWER:'OPEN',OPEN:'RETREAT',RETREAT:'VERIFY'}[phase];
          if (phase==='CLOSE') grasped=true;
          if (phase==='OPEN') {releasedCount=activeIndex+1;verifyTime=0;grasped=false;}
          if (next) {phase=next;dwell=0;}
        }
      }
      if (grasped && ['LIFT','CROSS','ALIGN'].includes(phase)) {
        lossTime=both?0:lossTime+DT;
        if(lossTime>.3){drops++;phase='APPROACH';dwell=0;grasped=false;lossTime=0;}
      } else lossTime=0;
    }
    active = params.blocks.find(b=>b.id===BLOCK_ORDER[activeIndex]);
    goal = goalFor(phase,active,params,state);
    const q=sim.joints.map(j=>j.getJointAngle()),dq=sim.joints.map(j=>j.getJointSpeed());
    if(!options.unforced)motorControl(sim,params,modelIndex,phase,active,goal,q,dq,['CLOSE','LIFT','CROSS','ALIGN','LOWER'].includes(phase));
    const torque=sim.joints.map(j=>j.getMotorTorque(1/DT)),jaw=sim.fingers.map(f=>f.joint.getMotorForce(1/DT));
    const stable = activeIndex===2&&['VERIFY','DONE'].includes(phase)?Math.min(STABLE_REQUIRED,verifyTime):0;
    const snapshot=stateSnapshot(sim,params,phase,active,currentStack,stable,goal,both,torque,jaw,sim.contacts);
    snapshot.t=Number(t.toFixed(6));
    if(tick%SAMPLE_EVERY===0||tick===ticks||success)frames.push(snapshot);
    if(!finite([q,dq,torque,jaw,snapshot.blocks.map(b=>[b.x,b.y,b.angle])])){failedReason='non-finite';break;}
    if(tick===ticks||success)break;
    effort+=torque.reduce((sum,n)=>sum+Math.abs(n),0)*DT;
    worldStep(sim.world,DT);
  }
  if(!success&&!failedReason)failedReason='timeout';
  const final=frames.at(-1);
  return {params,frames,metrics:{success,stackCount:final.stackCount,stableSeconds:final.stableSeconds,completionTime,drops,collisions:sim.getCollisions(),effort,failedReason}};
}

function worldStep(world, dt) {
  world.step(dt, 8, 3);
}

export default { createStackDemo };
