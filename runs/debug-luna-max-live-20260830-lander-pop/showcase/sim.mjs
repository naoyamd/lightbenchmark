const DT = 0.02;
const TAU = Math.PI * 2;

const BASELINE = Object.freeze({
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

function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("seed must be a uint32");
  }
  return seed >>> 0 || 1;
}

function normalizeParams(input = BASELINE) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("params must be an object");
  }
  const params = { ...BASELINE };
  for (const name of Object.keys(BASELINE)) {
    if (Object.prototype.hasOwnProperty.call(input, name)) params[name] = input[name];
  }
  for (const [name, range] of Object.entries(PARAM_RANGES)) {
    if (typeof params[name] !== "number" || !Number.isFinite(params[name])) throw new TypeError(`${name} must be finite`);
    if (params[name] < range[0] || params[name] > range[1]) throw new RangeError(`${name} is outside its allowed range`);
  }
  for (const name of ["K", "C", "phase"]) {
    if (typeof params[name] !== "number" || !Number.isFinite(params[name])) throw new TypeError(`${name} must be finite`);
  }
  if (params.phase < 0 || params.phase >= TAU) throw new RangeError("phase is outside [0, 2π)");
  return params;
}

function validateState(state) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) throw new TypeError("state must be an object");
  for (const key of ["t", "x", "y", "vx", "vy", "theta", "omega", "fuel"]) {
    if (typeof state[key] !== "number" || !Number.isFinite(state[key])) throw new TypeError(`state.${key} must be finite`);
  }
}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

function rounded(value) {
  const result = Math.round(value * 100) / 100;
  return Object.is(result, -0) ? 0 : result;
}

function randomSource(seed) {
  let x = validateSeed(seed);
  return () => {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    return x / 0x100000000;
  };
}

export function createScenario(seed, overrides = {}) {
  const random = randomSource(seed);
  const between = (lo, hi) => lo + (hi - lo) * random();
  const generated = {
    x: between(-28, 28),
    y: between(90, 120),
    vx: between(-6, 6),
    vy: between(-24, -14),
    theta: between(-0.18, 0.18),
    omega: between(-0.08, 0.08),
    phase: between(0, TAU),
  };
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("overrides must be an object");
  }
  generated.phase = overrides.phase ?? generated.phase;
  const params = normalizeParams({ ...overrides, phase: generated.phase });
  params.phase = generated.phase;

  return {
    state: {
      t: 0,
      x: generated.x,
      y: generated.y,
      vx: generated.vx,
      vy: generated.vy,
      theta: generated.theta,
      omega: generated.omega,
      fuel: params.fuel0,
    },
    params,
  };
}

export function stepPhysics(state, control = {}, params = BASELINE) {
  validateState(state);
  params = normalizeParams(params);
  const fuel = Number.isFinite(state.fuel) ? state.fuel : 0;
  const throttle = Number.isFinite(control?.throttle) ? control.throttle : 0;
  const gimbal = Number.isFinite(control?.gimbal) ? control.gimbal : 0;
  const u = fuel > 0 ? clamp(throttle, 0, 1) : 0;
  const delta = clamp(gimbal, -0.35, 0.35);
  const aT = params.aMax * u;
  const wind = params.windAmp * Math.sin(0.31 * state.t + params.phase);
  const ax = aT * Math.sin(state.theta + delta) + wind;
  const ay = aT * Math.cos(state.theta + delta) - params.g;
  const omega = state.omega + DT * (params.K * u * delta - params.C * state.omega);
  const theta = state.theta + DT * omega;
  const vx = state.vx + DT * ax;
  const x = state.x + DT * vx;
  const vy = state.vy + DT * ay;
  const y = state.y + DT * vy;

  return {
    t: state.t + DT,
    x,
    y,
    vx,
    vy,
    theta,
    omega,
    fuel: Math.max(0, fuel - 0.045 * u * DT),
  };
}

export function makeSensor(state, params = BASELINE) {
  validateState(state);
  params = normalizeParams(params);
  return {
    t: rounded(state.t),
    altitude: rounded(state.y),
    xOffset: rounded(state.x - params.padX),
    theta: rounded(state.theta),
    fuel: rounded(state.fuel),
  };
}

export function classify(state, params = BASELINE) {
  validateState(state);
  params = normalizeParams(params);
  if (Math.abs(state.theta) > Math.PI / 2) return "tip-over";
  if (Math.abs(state.x) > 80 || state.y > 180) return "out-of-bounds";
  if (state.t >= 20) return "timeout";
  if (state.y > 0) return "flying";
  if (Math.abs(state.x - params.padX) > params.padHalf) return "off-pad";
  if (Math.abs(state.theta) > (8 * Math.PI) / 180 || Math.abs(state.omega) > (15 * Math.PI) / 180) {
    return "tip-over";
  }
  if (Math.abs(state.vx) > 2 || Math.abs(state.vy) > 3) return "hard-crash";
  return "landed";
}

export function xorshift32(seed) {
  let x = validateSeed(seed);
  return () => {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    return x;
  };
}

export { DT, BASELINE as DEFAULT_PARAMS };
