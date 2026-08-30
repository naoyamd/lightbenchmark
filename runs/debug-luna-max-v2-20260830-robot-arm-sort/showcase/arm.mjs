const TAU = Math.PI * 2;
const EPS = 1e-8;

/** Forward kinematics for an absolute first angle and relative second angle. */
export function forward(joints, spec) {
  const [q1, q2] = joints;
  const [bx, by] = spec.base;
  const [l1, l2] = spec.links;
  const elbow = [bx + l1 * Math.cos(q1), by + l1 * Math.sin(q1)];
  const tool = [
    elbow[0] + l2 * Math.cos(q1 + q2),
    elbow[1] + l2 * Math.sin(q1 + q2),
  ];
  return { elbow, tool };
}

function inLimit(value, limit) {
  return value >= limit[0] - 1e-7 && value <= limit[1] + 1e-7;
}

function nearestEquivalent(value, limit) {
  let best = null;
  for (let k = -2; k <= 2; k += 1) {
    const candidate = value + k * TAU;
    if (inLimit(candidate, limit) && (best === null || Math.abs(candidate - value) < Math.abs(best - value))) {
      best = candidate;
    }
  }
  return best;
}

/** Inverse kinematics. The returned q2 is relative to q1. */
export function inverse(target, spec, elbow = "up") {
  const dx = target[0] - spec.base[0];
  const dy = target[1] - spec.base[1];
  const [l1, l2] = spec.links;
  const radius2 = dx * dx + dy * dy;
  const cosine = (radius2 - l1 * l1 - l2 * l2) / (2 * l1 * l2);
  if (cosine < -1 - 1e-7 || cosine > 1 + 1e-7) return null;
  const bend = Math.acos(Math.max(-1, Math.min(1, cosine)));
  const signedBend = elbow === "down" ? -bend : bend;
  const q1Raw = Math.atan2(dy, dx) - Math.atan2(l2 * Math.sin(signedBend), l1 + l2 * Math.cos(signedBend));
  const q1 = nearestEquivalent(q1Raw, spec.jointLimits[0]);
  const q2 = nearestEquivalent(signedBend, spec.jointLimits[1]);
  if (q1 === null || q2 === null) return null;
  return [Math.abs(q1) < 1e-14 ? 0 : q1, Math.abs(q2) < 1e-14 ? 0 : q2];
}

function segmentTouchesRect(a, b, rect) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const tests = [
    [-dx, a[0] - rect.minX],
    [dx, rect.maxX - a[0]],
    [-dy, a[1] - rect.minY],
    [dy, rect.maxY - a[1]],
  ];
  for (const [p, q] of tests) {
    if (Math.abs(p) < EPS) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1 + EPS && t1 >= -EPS && t0 <= 1 + EPS;
}

function configurationValid(joints, spec, obstacles, carrying) {
  if (!joints || joints.length !== 2) return false;
  if (!inLimit(joints[0], spec.jointLimits[0]) || !inLimit(joints[1], spec.jointLimits[1])) return false;
  const pose = forward(joints, spec);
  if (pose.elbow[1] < spec.clearance - 1e-7 || pose.tool[1] < spec.clearance - 1e-7) return false;
  const extra = spec.clearance + (carrying ? 5 : 0) + 1e-7;
  for (const obstacle of obstacles) {
    const rect = {
      minX: obstacle.minX - extra,
      maxX: obstacle.maxX + extra,
      minY: obstacle.minY - extra,
      maxY: obstacle.maxY + extra,
    };
    if (segmentTouchesRect(spec.base, pose.elbow, rect) || segmentTouchesRect(pose.elbow, pose.tool, rect)) return false;
  }
  return true;
}

function edgeValid(a, b, spec, obstacles, carrying) {
  const distance = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  const steps = Math.max(2, Math.ceil(distance / 0.018));
  for (let i = 0; i <= steps; i += 1) {
    const ratio = i / steps;
    const q = [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
    if (!configurationValid(q, spec, obstacles, carrying)) return false;
  }
  return true;
}

function axisValues(limit, step) {
  const values = [];
  for (let value = limit[0]; value < limit[1] - 1e-9; value += step) values.push(value);
  values.push(limit[1]);
  return values;
}

function nearestAxisIndex(values, value) {
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const next = Math.abs(values[i] - value);
    if (next < distance) { distance = next; best = i; }
  }
  return best;
}

class MinHeap {
  constructor() { this.data = []; }
  push(item, priority) {
    const entry = { item, priority };
    this.data.push(entry);
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].priority <= priority) break;
      this.data[i] = this.data[p];
      i = p;
    }
    this.data[i] = entry;
  }
  pop() {
    if (!this.data.length) return null;
    const first = this.data[0];
    const last = this.data.pop();
    if (this.data.length && last) {
      let i = 0;
      while (true) {
        let child = i * 2 + 1;
        if (child >= this.data.length) break;
        if (child + 1 < this.data.length && this.data[child + 1].priority < this.data[child].priority) child += 1;
        if (this.data[child].priority >= last.priority) break;
        this.data[i] = this.data[child];
        i = child;
      }
      this.data[i] = last;
    }
    return first.item;
  }
}

function gridPath(start, goal, spec, obstacles, carrying, spacing) {
  if (!configurationValid(start, spec, obstacles, carrying) || !configurationValid(goal, spec, obstacles, carrying)) return null;
  if (edgeValid(start, goal, spec, obstacles, carrying)) return [start.slice(), goal.slice()];

  const q1s = axisValues(spec.jointLimits[0], spacing);
  const q2s = axisValues(spec.jointLimits[1], spacing);
  const width = q2s.length;
  const startId = q1s.length * width;
  const goalId = startId + 1;
  const idOf = (i, j) => i * width + j;
  const gridQ = id => [q1s[Math.floor(id / width)], q2s[id % width]];
  const startI = nearestAxisIndex(q1s, start[0]);
  const startJ = nearestAxisIndex(q2s, start[1]);
  const goalI = nearestAxisIndex(q1s, goal[0]);
  const goalJ = nearestAxisIndex(q2s, goal[1]);
  const valid = new Uint8Array(q1s.length * width);
  for (let i = 0; i < q1s.length; i += 1) {
    for (let j = 0; j < width; j += 1) valid[idOf(i, j)] = configurationValid([q1s[i], q2s[j]], spec, obstacles, carrying) ? 1 : 0;
  }
  const qOf = id => id === startId ? start : id === goalId ? goal : gridQ(id);
  const heap = new MinHeap();
  const cameFrom = new Map();
  const cost = new Map([[startId, 0]]);
  const closed = new Uint8Array(startId + 2);
  const edgeCache = new Map();
  const edgeBetween = (aId, bId) => {
    const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
    if (edgeCache.has(key)) return edgeCache.get(key);
    const result = edgeValid(qOf(aId), qOf(bId), spec, obstacles, carrying);
    edgeCache.set(key, result);
    return result;
  };
  const goalDistance = q => Math.hypot(q[0] - goal[0], q[1] - goal[1]);
  heap.push(startId, goalDistance(start));

  const neighbors = id => {
    const result = [];
    if (id === goalId) return result;
    if (id === startId) {
      for (let i = Math.max(0, startI - 3); i <= Math.min(q1s.length - 1, startI + 3); i += 1) {
        for (let j = Math.max(0, startJ - 3); j <= Math.min(width - 1, startJ + 3); j += 1) {
          const next = idOf(i, j);
          if (valid[next] && edgeBetween(startId, next)) result.push(next);
        }
      }
      return result;
    }
    const i = Math.floor(id / width);
    const j = id % width;
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || ni >= q1s.length || nj < 0 || nj >= width) continue;
        const next = idOf(ni, nj);
        if (valid[next] && edgeBetween(id, next)) result.push(next);
      }
    }
    const q = gridQ(id);
    if (Math.hypot(q[0] - start[0], q[1] - start[1]) <= spacing * 3.2 && edgeBetween(id, startId)) result.push(startId);
    if (Math.hypot(q[0] - goal[0], q[1] - goal[1]) <= spacing * 3.2 && edgeBetween(id, goalId)) result.push(goalId);
    return result;
  };

  let iterations = 0;
  while (heap.data.length && iterations++ < 30000) {
    const current = heap.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === goalId) {
      const path = [];
      let cursor = current;
      while (cursor !== undefined) {
        path.push(qOf(cursor).slice());
        cursor = cameFrom.get(cursor);
      }
      path.reverse();
      return path;
    }
    const currentCost = cost.get(current);
    for (const next of neighbors(current)) {
      const stepCost = Math.hypot(qOf(next)[0] - qOf(current)[0], qOf(next)[1] - qOf(current)[1]);
      const nextCost = currentCost + stepCost;
      if (nextCost < (cost.get(next) ?? Infinity)) {
        cost.set(next, nextCost);
        cameFrom.set(next, current);
        heap.push(next, nextCost + goalDistance(qOf(next)));
      }
    }
  }
  return null;
}

function findRoute(start, target, spec, obstacles, carrying) {
  const candidates = [inverse(target, spec, "up"), inverse(target, spec, "down")].filter(Boolean);
  const routes = [];
  for (const candidate of candidates) {
    let route = gridPath(start, candidate, spec, obstacles, carrying, 0.09);
    if (!route) route = gridPath(start, candidate, spec, obstacles, carrying, 0.14);
    if (route) routes.push(route);
  }
  if (!routes.length) return null;
  routes.sort((a, b) => {
    const length = path => path.reduce((sum, q, i) => i ? sum + Math.hypot(q[0] - path[i - 1][0], q[1] - path[i - 1][1]) : 0, 0);
    return length(a) - length(b);
  });
  return routes[0];
}

function appendMotion(frames, route, grip, clock, spec) {
  let time = clock;
  const speeds = spec.maxSpeeds;
  for (let i = 1; i < route.length; i += 1) {
    const before = route[i - 1];
    const joints = route[i].slice();
    if (Math.hypot(joints[0] - before[0], joints[1] - before[1]) < 1e-10) continue;
    const required = Math.max(Math.abs(joints[0] - before[0]) / speeds[0], Math.abs(joints[1] - before[1]) / speeds[1]);
    time += Math.max(0.025, required + 1e-7);
    frames.push({ t: time, joints, grip });
  }
  return time;
}

function appendHold(frames, joints, grip, clock) {
  const time = clock + 0.04;
  frames.push({ t: time, joints: joints.slice(), grip });
  return time;
}

/**
 * Build a deterministic, collision-checked joint-space plan for every item.
 * No input arrays are retained or modified.
 */
export function planSort(scenario) {
  const spec = scenario.spec;
  const obstacles = Array.isArray(scenario.obstacles) ? scenario.obstacles : [];
  const frames = [{ t: 0, joints: spec.home.slice(), grip: false }];
  let current = spec.home.slice();
  let clock = 0;
  let gripping = false;

  for (const item of scenario.items ?? []) {
    const pickupRoute = findRoute(current, item.pickup, spec, obstacles, false);
    if (!pickupRoute) throw new Error(`No safe route to pickup ${item.id}`);
    clock = appendMotion(frames, pickupRoute, false, clock, spec);
    current = pickupRoute.at(-1).slice();
    clock = appendHold(frames, current, true, clock);
    gripping = true;

    const targetRoute = findRoute(current, item.target, spec, obstacles, true);
    if (!targetRoute) throw new Error(`No safe carrying route to target ${item.id}`);
    clock = appendMotion(frames, targetRoute, true, clock, spec);
    current = targetRoute.at(-1).slice();
    clock = appendHold(frames, current, false, clock);
    gripping = false;
  }
  // Keep the state represented explicitly even when a caller supplies no items.
  if (frames.at(-1).grip !== gripping) {
    clock = appendHold(frames, current, gripping, clock);
  }
  return frames.map(frame => ({ t: frame.t, joints: frame.joints.slice(), grip: frame.grip }));
}
