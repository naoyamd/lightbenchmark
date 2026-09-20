import * as pl from './vendor/planck.mjs';

/**
 * Shared Planck plant. Candidate controllers receive observations and bounded motor commands only. */

const DT = 0.005;
const SAMPLE_EVERY = 10;
const GRAVITY = -9.81;
const STABLE_REQUIRED = 3;
const FINGER_WIDTH = 0.036;
const FINGER_HEIGHT = 0.1;
const INITIAL_JAW_OPENING = 0.58;
const FINGER_EXTENSION = 0.18;
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

export function makeParams(seed) {
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

export function simulateArm(seed, controller) {
  const params = makeParams(seed), sim = createWorld(params), frames = [];
  controller.call('reset', params);
  let stableSeconds = 0, completionTime = null, effort = 0, drops = 0;
  let command = { jointSpeeds: [0, 0, 0], gripperOpening: .58 }, failedReason = null;
  const previousHeld = new Set();
  const caps = [1.1, 1.1, 4];
  for (let tick = 0; tick <= params.duration / DT; tick++) {
    const t = tick * DT;
    const q = sim.joints.map(j => j.getJointAngle()), dq = sim.joints.map(j => j.getJointSpeed());
    const count = stackCount(sim, params, sim.contacts);
    const active = params.blocks[Math.min(2, count)];
    const torque = sim.joints.map(j => j.getMotorTorque(1 / DT));
    const jaw = sim.fingers.map(f => f.joint.getMotorForce(1 / DT));
    const frame = stateSnapshot(sim, params, 'CONTROL', active, count, stableSeconds, [params.stackX, params.goalSlots[Math.min(2,count)].y], contactForBlock(sim.contacts,active.id), torque, jaw, sim.contacts);
    frame.t = Number(t.toFixed(6));
    const toolVelocity = sim.palm.getLinearVelocityFromWorldPoint(v(...frame.tool));
    const blocks = frame.blocks.map(b => {
      const body = sim.blockBodies.get(b.id), velocity = body.getLinearVelocity();
      return { ...b, vx: velocity.x, vy: velocity.y, angularVelocity: body.getAngularVelocity() };
    });
    const retreat = distance(frame.tool, [params.stackX,params.goalSlots.at(-1).y]) > .25;
    stableSeconds = count === 3 && retreat ? stableSeconds + DT : 0;
    frame.stableSeconds = Math.min(STABLE_REQUIRED, stableSeconds);
    for (const box of blocks) {
      const held = contactForBlock(sim.contacts,box.id);
      if (previousHeld.has(box.id) && !held && box.vy < -.2 && box.y > params.tableY + .2) drops++;
      if (held) previousHeld.add(box.id); else previousHeld.delete(box.id);
    }
    if (stableSeconds >= STABLE_REQUIRED) { completionTime = frame.t; frame.phase = 'DONE'; }
    if (tick % 4 === 0 && completionTime === null) {
      try {
        command = controller.call('step', { t: frame.t, q, dq, tool: frame.tool, toolVelocity: [toolVelocity.x,toolVelocity.y], palmAngle: frame.palm.angle, gripperOpening: frame.gripperOpening, blocks, contacts: frame.contacts, stackCount: count, stableSeconds: frame.stableSeconds }, .02);
        if (!command || !Array.isArray(command.jointSpeeds) || command.jointSpeeds.length !== 3 || !command.jointSpeeds.every(Number.isFinite) || !Number.isFinite(command.gripperOpening)) throw new Error('step must return finite jointSpeeds[3] and gripperOpening');
      } catch (error) { failedReason = error.message; frame.phase = 'FAILED'; }
    }
    if (tick % SAMPLE_EVERY === 0 || failedReason || completionTime !== null || tick === params.duration / DT) frames.push(frame);
    if (failedReason || completionTime !== null || tick === params.duration / DT) break;
    sim.joints.forEach((joint,i) => joint.setMotorSpeed(clamp(command.jointSpeeds[i], -caps[i],caps[i])));
    for (const finger of sim.fingers) {
      const desired = finger.side * (clamp(command.gripperOpening,0,.6) + FINGER_WIDTH) / 2;
      const measured = finger.initialOffset + finger.joint.getJointTranslation();
      finger.joint.setMotorSpeed(clamp(5 * (desired - measured),-.14,.14));
    }
    effort += torque.reduce((sum,value) => sum + Math.abs(value),0) * DT;
    sim.world.step(DT,8,3);
    if (!finite([q,dq,blocks.map(b=>[b.x,b.y,b.angle])])) { failedReason = 'non-finite physical state'; break; }
  }
  const last = frames.at(-1), success = completionTime !== null;
  return { params, frames, metrics: { success, stackCount: last.stackCount, stableSeconds: last.stableSeconds, completionTime, drops, collisions: sim.getCollisions(), effort, failedReason: success ? null : failedReason ?? 'time limit' } };
}
