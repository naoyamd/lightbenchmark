export const SPEC = Object.freeze({
  base: [0, 0],
  links: [150, 120],
  jointLimits: [[-2.9, 2.9], [-2.7, 2.7]],
  maxSpeeds: [1.2, 1.5],
  clearance: 5,
  gripRadius: 10,
  binRadius: 18,
  home: [Math.PI / 2, 0],
});

const finitePair = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const copy = (value) => structuredClone(value);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function normalizedSpec(spec = SPEC) {
  if (!spec || !finitePair(spec.base) || !finitePair(spec.links) || !finitePair(spec.maxSpeeds)
    || !finitePair(spec.home) || !Array.isArray(spec.jointLimits) || spec.jointLimits.length !== 2
    || spec.jointLimits.some((limit) => !finitePair(limit))) throw new TypeError("invalid arm spec");
  for (const name of ["clearance", "gripRadius", "binRadius"]) {
    if (!Number.isFinite(spec[name]) || spec[name] < 0) throw new TypeError(`invalid spec.${name}`);
  }
  return spec;
}

function validJoints(joints, spec) {
  return finitePair(joints) && joints.every((angle, index) => (
    angle >= spec.jointLimits[index][0] && angle <= spec.jointLimits[index][1]
  ));
}

export function forward(joints, spec = SPEC) {
  spec = normalizedSpec(spec);
  if (!validJoints(joints, spec)) throw new RangeError("joints outside limits");
  const [q1, q2] = joints;
  const elbow = [spec.base[0] + spec.links[0] * Math.cos(q1), spec.base[1] + spec.links[0] * Math.sin(q1)];
  const tool = [elbow[0] + spec.links[1] * Math.cos(q1 + q2), elbow[1] + spec.links[1] * Math.sin(q1 + q2)];
  return { elbow, tool };
}

export function inverse(target, spec = SPEC, elbow = "up") {
  spec = normalizedSpec(spec);
  if (!finitePair(target) || !["up", "down"].includes(elbow)) throw new TypeError("invalid inverse input");
  const x = target[0] - spec.base[0];
  const y = target[1] - spec.base[1];
  const [a, b] = spec.links;
  const cosine = (x * x + y * y - a * a - b * b) / (2 * a * b);
  if (cosine < -1 - 1e-12 || cosine > 1 + 1e-12) return null;
  const q2 = (elbow === "up" ? 1 : -1) * Math.acos(Math.max(-1, Math.min(1, cosine)));
  const q1 = Math.atan2(y, x) - Math.atan2(b * Math.sin(q2), a + b * Math.cos(q2));
  const joints = [q1, q2];
  return validJoints(joints, spec) ? joints : null;
}

function segmentHitsRect(start, end, rect, padding) {
  const bounds = [rect.minX - padding, rect.maxX + padding, rect.minY - padding, rect.maxY + padding];
  let low = 0;
  let high = 1;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  for (const [p, q] of [[-dx, start[0] - bounds[0]], [dx, bounds[1] - start[0]], [-dy, start[1] - bounds[2]], [dy, bounds[3] - start[1]]]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) low = Math.max(low, ratio);
    else high = Math.min(high, ratio);
    if (low > high) return false;
  }
  return true;
}

export function configurationSafe(joints, scenario, carrying = false) {
  const spec = normalizedSpec(scenario?.spec);
  if (!validJoints(joints, spec)) return false;
  const { elbow, tool } = forward(joints, spec);
  if (elbow[1] < spec.clearance || tool[1] < spec.clearance) return false;
  const padding = spec.clearance + (carrying ? 5 : 0);
  return (scenario.obstacles ?? []).every((rect) => (
    !segmentHitsRect(spec.base, elbow, rect, padding)
    && !segmentHitsRect(elbow, tool, rect, padding)
  ));
}

function safeMotion(start, end, scenario, carrying) {
  const steps = Math.max(2, Math.ceil(Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1])) / 0.01));
  for (let index = 0; index <= steps; index += 1) {
    const alpha = index / steps;
    if (!configurationSafe([
      start[0] + (end[0] - start[0]) * alpha,
      start[1] + (end[1] - start[1]) * alpha,
    ], scenario, carrying)) return false;
  }
  return true;
}

function route(start, goal, scenario, carrying) {
  if (safeMotion(start, goal, scenario, carrying)) return [goal];
  const step = 0.08;
  const limits = scenario.spec.jointLimits;
  const counts = limits.map(([low, high]) => Math.floor((high - low) / step) + 1);
  const point = ([a, b]) => [limits[0][0] + a * step, limits[1][0] + b * step];
  const key = ([a, b]) => `${a},${b}`;
  const nearby = (joints) => {
    const center = joints.map((angle, index) => Math.round((angle - limits[index][0]) / step));
    const result = [];
    for (let da = -2; da <= 2; da += 1) for (let db = -2; db <= 2; db += 1) {
      const node = [center[0] + da, center[1] + db];
      if (node[0] >= 0 && node[0] < counts[0] && node[1] >= 0 && node[1] < counts[1]) {
        const jointsAtNode = point(node);
        if (safeMotion(joints, jointsAtNode, scenario, carrying)) result.push(node);
      }
    }
    return result;
  };
  const starts = nearby(start);
  const goals = new Map(nearby(goal).map(node => [key(node), node]));
  if (!starts.length || !goals.size) return null;
  const open = starts.map(node => ({ node, cost: 0 }));
  const cost = new Map(starts.map(node => [key(node), 0]));
  const previous = new Map();
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let found = null;
  while (open.length) {
    open.sort((a, b) => a.score - b.score || a.node[0] - b.node[0] || a.node[1] - b.node[1]);
    const current = open.shift();
    const currentKey = key(current.node);
    if (current.cost !== cost.get(currentKey)) continue;
    if (goals.has(currentKey)) { found = current.node; break; }
    for (const direction of directions) {
      const next = [current.node[0] + direction[0], current.node[1] + direction[1]];
      if (next[0] < 0 || next[0] >= counts[0] || next[1] < 0 || next[1] >= counts[1]) continue;
      const from = point(current.node);
      const to = point(next);
      if (!safeMotion(from, to, scenario, carrying)) continue;
      const nextCost = current.cost + Math.hypot(direction[0], direction[1]);
      const nextKey = key(next);
      if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
      cost.set(nextKey, nextCost);
      previous.set(nextKey, current.node);
      const heuristic = Math.min(...[...goals.values()].map(node => Math.hypot(node[0] - next[0], node[1] - next[1])));
      open.push({ node: next, cost: nextCost, score: nextCost + heuristic });
    }
  }
  if (!found) return null;
  const nodes = [];
  for (let node = found; node; node = previous.get(key(node))) nodes.push(node);
  nodes.reverse();
  const raw = nodes.map(point);
  const path = [];
  for (let index = 0; index < raw.length;) {
    let next = raw.length - 1;
    while (next > index && !safeMotion(path.at(-1) ?? start, raw[next], scenario, carrying)) next -= 1;
    path.push(raw[next]);
    index = next + 1;
  }
  if (!safeMotion(path.at(-1), goal, scenario, carrying)) return null;
  path.push(goal);
  return path;
}

function routeFromHome(target, scenario, carrying) {
  for (const elbow of ["up", "down"]) {
    const joints = inverse(target, scenario.spec, elbow);
    const path = joints && route(scenario.spec.home, joints, scenario, carrying);
    if (path) return path;
  }
  throw new RangeError(`no collision-free route to ${target.join(",")}`);
}

function appendKeyframe(keyframes, joints, grip, spec) {
  const previous = keyframes.at(-1);
  const duration = previous
    ? Math.max(0.12, ...joints.map((angle, index) => Math.abs(angle - previous.joints[index]) / (spec.maxSpeeds[index] * 0.8)))
    : 0;
  keyframes.push({ t: (previous?.t ?? 0) + duration, joints: joints.slice(), grip });
}

export function planSort(scenario) {
  const spec = normalizedSpec(scenario?.spec);
  const keyframes = [{ t: 0, joints: spec.home.slice(), grip: false }];
  for (const item of scenario.items ?? []) {
    const pickupRoute = routeFromHome(item.pickup, scenario, true);
    for (const joints of pickupRoute) appendKeyframe(keyframes, joints, false, spec);
    appendKeyframe(keyframes, pickupRoute.at(-1), true, spec);
    for (const joints of pickupRoute.slice(0, -1).reverse()) appendKeyframe(keyframes, joints, true, spec);
    appendKeyframe(keyframes, spec.home, true, spec);
    const targetRoute = routeFromHome(item.target, scenario, true);
    for (const joints of targetRoute) appendKeyframe(keyframes, joints, true, spec);
    appendKeyframe(keyframes, targetRoute.at(-1), false, spec);
    for (const joints of targetRoute.slice(0, -1).reverse()) appendKeyframe(keyframes, joints, false, spec);
    appendKeyframe(keyframes, spec.home, false, spec);
  }
  return keyframes;
}

export function simulatePlan(scenario, keyframes) {
  const errors = [];
  const spec = normalizedSpec(scenario?.spec);
  if (!Array.isArray(keyframes) || keyframes.length < 2) return { pass: false, sorted: [], errors: ["plan needs keyframes"] };
  const items = new Map((scenario.items ?? []).map((item) => [item.id, { ...copy(item), position: item.pickup.slice(), sorted: false }]));
  let held = null;
  let previous = null;
  let previousGrip = false;
  const events = [];
  for (const [index, frame] of keyframes.entries()) {
    if (!Number.isFinite(frame?.t) || !validJoints(frame?.joints, spec) || typeof frame.grip !== "boolean"
      || (index === 0 && frame.t !== 0) || (previous && frame.t <= previous.t)) {
      errors.push(`invalid keyframe ${index}`);
      break;
    }
    if (previous) {
      const dt = frame.t - previous.t;
      for (let joint = 0; joint < 2; joint += 1) {
        if (Math.abs(frame.joints[joint] - previous.joints[joint]) / dt > spec.maxSpeeds[joint] + 1e-9) {
          errors.push(`joint speed exceeded at ${index}`);
        }
      }
      if (!safeMotion(previous.joints, frame.joints, scenario, Boolean(held))) errors.push(`collision at keyframe ${index}`);
    } else if (!configurationSafe(frame.joints, scenario, false)) {
      errors.push("unsafe initial configuration");
    }
    const tool = forward(frame.joints, spec).tool;
    if (!previousGrip && frame.grip) {
      const choices = [...items.values()].filter((item) => !item.sorted && distance(item.position, tool) <= spec.gripRadius);
      if (held || choices.length !== 1) errors.push(`invalid grip at ${index}`);
      else {
        held = choices[0];
        events.push({ type: "pick", id: held.id, t: frame.t });
      }
    }
    if (held) held.position = tool.slice();
    if (previousGrip && !frame.grip) {
      if (!held || distance(held.target, tool) > spec.binRadius) errors.push(`invalid release at ${index}`);
      else {
        held.sorted = true;
        held.position = held.target.slice();
        events.push({ type: "place", id: held.id, t: frame.t });
        held = null;
      }
    }
    previous = { t: frame.t, joints: frame.joints.slice() };
    previousGrip = frame.grip;
  }
  if (held) errors.push("plan ended while holding an item");
  const sorted = [...items.values()].filter((item) => item.sorted).map((item) => item.id);
  if (sorted.length !== items.size) errors.push("not all items were sorted");
  return { pass: errors.length === 0, sorted, events, duration: previous?.t ?? 0, errors };
}

function xorshift(seed) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>>= 0) / 0x100000000;
  };
}

export function createScenario(seed = 0x12345678) {
  const random = xorshift(seed);
  const jitter = () => Math.round((random() - 0.5) * 8);
  const spec = copy(SPEC);
  const items = [
    { id: "cyan", color: "cyan", pickup: [-188 + jitter(), 48 + jitter()], target: [188 + jitter(), 48 + jitter()] },
    { id: "magenta", color: "magenta", pickup: [-158 + jitter(), 92 + jitter()], target: [160 + jitter(), 92 + jitter()] },
    { id: "yellow", color: "yellow", pickup: [-205 + jitter(), 118 + jitter()], target: [207 + jitter(), 118 + jitter()] },
  ];
  return {
    seed: seed >>> 0,
    spec,
    obstacles: [{ minX: 105 + jitter(), maxX: 135 + jitter(), minY: 135, maxY: 170 + jitter() }],
    items,
  };
}

export default { SPEC, forward, inverse, configurationSafe, planSort, simulatePlan, createScenario };
