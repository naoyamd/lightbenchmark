export const DT = 0.02;
export const CONTROL_PERIOD = 0.1;
export const CONTROL_STEPS = 5;

export const DEFAULT_PARAMS = Object.freeze({
  g: 9.81,
  aMax: 22,
  K: 8,
  C: 0.8,
  windAmp: 0.2,
  padX: 0,
  padHalf: 6,
  fuel0: 0.65,
  phase: 0,
});

const PARAM_RANGES = {
  g: [9.4, 10.2],
  aMax: [20.5, 23.5],
  windAmp: [0, 0.4],
  padX: [-10, 10],
  padHalf: [5.5, 6.5],
  fuel0: [0.55, 0.75],
};

const STATE_KEYS = ["t", "x", "y", "vx", "vy", "theta", "omega", "fuel"];
const TAU = Math.PI * 2;
const SAFE_THETA = 8 * Math.PI / 180;
const SAFE_OMEGA = 15 * Math.PI / 180;

function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("seed must be a uint32");
  }
  return seed >>> 0 || 1;
}

export function xorshift32(seed) {
  let value = validateSeed(seed);
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value >>>= 0;
    return value;
  };
}

function validateParam(name, value, range) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  if (range && (value < range[0] || value > range[1])) {
    throw new RangeError(`${name} is outside its allowed range`);
  }
  return value;
}

function normalizeParams(params = {}) {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError("params must be an object");
  }
  const normalized = { ...DEFAULT_PARAMS };
  for (const name of Object.keys(DEFAULT_PARAMS)) {
    if (Object.prototype.hasOwnProperty.call(params, name)) normalized[name] = params[name];
  }
  for (const [name, range] of Object.entries(PARAM_RANGES)) validateParam(name, normalized[name], range);
  validateParam("K", normalized.K);
  validateParam("C", normalized.C);
  validateParam("phase", normalized.phase);
  if (normalized.phase < 0 || normalized.phase >= TAU) throw new RangeError("phase is outside [0, 2π)");
  return normalized;
}

function validateState(state) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("state must be an object");
  }
  for (const key of STATE_KEYS) {
    if (typeof state[key] !== "number" || !Number.isFinite(state[key])) {
      throw new TypeError(`state.${key} must be finite`);
    }
  }
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function controlValues(control) {
  const throttle = typeof control?.throttle === "number" && Number.isFinite(control.throttle)
    ? control.throttle : 0;
  const gimbal = typeof control?.gimbal === "number" && Number.isFinite(control.gimbal)
    ? control.gimbal : 0;
  return { throttle: clamp(throttle, 0, 1), gimbal: clamp(gimbal, -0.35, 0.35) };
}

function round2(value) {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function createScenario(seed, overrides = {}) {
  const nextUint32 = xorshift32(seed);
  const random = () => nextUint32() / 0x100000000;
  const generated = {
    x: -28 + 56 * random(),
    y: 90 + 30 * random(),
    vx: -6 + 12 * random(),
    vy: -24 + 10 * random(),
    theta: -0.18 + 0.36 * random(),
    omega: -0.08 + 0.16 * random(),
    phase: TAU * random(),
  };
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("overrides must be an object");
  }
  const params = normalizeParams({ ...overrides, phase: overrides.phase ?? generated.phase });
  const state = {
    t: 0,
    x: generated.x,
    y: generated.y,
    vx: generated.vx,
    vy: generated.vy,
    theta: generated.theta,
    omega: generated.omega,
    fuel: params.fuel0,
  };
  return { state, params };
}

export function stepPhysics(state, control, params = DEFAULT_PARAMS) {
  validateState(state);
  const { g, aMax, K, C, windAmp, phase } = normalizeParams(params);
  const { throttle, gimbal } = controlValues(control);
  const u = state.fuel > 0 ? throttle : 0;
  const delta = gimbal;
  const aT = aMax * u;
  const wind = windAmp * Math.sin(0.31 * state.t + phase);
  const ax = aT * Math.sin(state.theta + delta) + wind;
  const ay = aT * Math.cos(state.theta + delta) - g;
  const omega = state.omega + DT * (K * u * delta - C * state.omega);
  const theta = state.theta + DT * omega;
  const vx = state.vx + DT * ax;
  const x = state.x + DT * vx;
  const vy = state.vy + DT * ay;
  const y = state.y + DT * vy;
  const fuel = Math.max(0, state.fuel - 0.045 * u * DT);
  return {
    t: state.t + DT,
    x,
    y,
    vx,
    vy,
    theta,
    omega,
    fuel,
  };
}

export function makeSensor(state, params = DEFAULT_PARAMS) {
  validateState(state);
  const { padX } = normalizeParams(params);
  return {
    t: round2(state.t),
    altitude: round2(state.y),
    xOffset: round2(state.x - padX),
    theta: round2(state.theta),
    fuel: round2(state.fuel),
  };
}

export function classify(state, params = DEFAULT_PARAMS) {
  validateState(state);
  const { padX, padHalf } = normalizeParams(params);
  if (Math.abs(state.theta) > Math.PI / 2) return "tip-over";
  if (Math.abs(state.x) > 80 || state.y > 180) return "out-of-bounds";
  if (state.t >= 20) return "timeout";
  if (state.y > 0) return "flying";
  if (Math.abs(state.x - padX) > padHalf) return "off-pad";
  if (Math.abs(state.theta) > SAFE_THETA || Math.abs(state.omega) > SAFE_OMEGA) return "tip-over";
  if (Math.abs(state.vx) > 2 || Math.abs(state.vy) > 3) {
    return "hard-crash";
  }
  return "landed";
}

function makeController(source) {
  if (source && typeof source.step === "function") return source;
  if (typeof source !== "function") {
    return { step: () => ({ throttle: 0, gimbal: 0 }) };
  }
  let candidate;
  try {
    candidate = source();
  } catch {
    candidate = undefined;
  }
  if (candidate && typeof candidate.step === "function") return candidate;
  if (typeof candidate === "function") return { step: candidate };
  return { step: source };
}

export function runController(seed, controller, overrides = {}) {
  if (typeof seed !== "number") {
    [controller, seed] = [seed, controller];
  }
  const scenario = createScenario(seed, overrides);
  const controllerInstance = makeController(controller);
  let state = scenario.state;
  let status = classify(state, scenario.params);
  const telemetry = [];
  let physicsStep = 0;

  while (status === "flying" && physicsStep < 1000) {
    const sensor = makeSensor(state, scenario.params);
    const rawControl = controllerInstance.step({ ...sensor });
    const control = controlValues(rawControl);
    for (let held = 0; held < CONTROL_STEPS && physicsStep < 1000; held += 1) {
      state = stepPhysics(state, control, scenario.params);
      status = classify(state, scenario.params);
      telemetry.push({
        step: physicsStep,
        t: state.t,
        state: { ...state },
        sensor: { ...sensor },
        control: { ...control },
        status,
      });
      physicsStep += 1;
      if (status !== "flying") break;
    }
  }
  return { state, params: scenario.params, status, telemetry };
}

export default {
  DT,
  CONTROL_PERIOD,
  CONTROL_STEPS,
  DEFAULT_PARAMS,
  xorshift32,
  createScenario,
  stepPhysics,
  makeSensor,
  classify,
  runController,
};
