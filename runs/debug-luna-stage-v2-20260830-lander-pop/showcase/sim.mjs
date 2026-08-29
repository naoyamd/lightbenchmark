const TAU = Math.PI * 2;

const DEFAULTS = Object.freeze({
  g: 9.81,
  aMax: 22,
  K: 8,
  C: 0.8,
  windAmp: 0.2,
  gustAmp: 0.08,
  dragCoeff: 0.0025,
  padX: 0,
  padHalf: 6,
  fuel0: 0.65,
  phase: 0,
});

const DT = 0.02;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function xorshift32(seed) {
  let x = (seed >>> 0) || 1;
  return () => {
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    return x >>> 0;
  };
}

function range(next, low, high) {
  return low + (next() / 0x100000000) * (high - low);
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/** Create the deterministic public-v1 initial state and its physics parameters. */
export function createScenario(seed, overrides = {}) {
  const next = xorshift32(seed);
  const generated = {
    x: range(next, -28, 28),
    y: range(next, 90, 120),
    vx: range(next, -6, 6),
    vy: range(next, -24, -14),
    theta: range(next, -0.18, 0.18),
    omega: range(next, -0.08, 0.08),
    phase: range(next, 0, TAU),
  };
  const params = {
    ...DEFAULTS,
    ...overrides,
    phase: Number.isFinite(overrides.phase) ? overrides.phase : generated.phase,
  };
  params.g = finiteOr(params.g, DEFAULTS.g);
  params.aMax = finiteOr(params.aMax, DEFAULTS.aMax);
  params.K = finiteOr(params.K, DEFAULTS.K);
  params.C = finiteOr(params.C, DEFAULTS.C);
  params.windAmp = finiteOr(params.windAmp, DEFAULTS.windAmp);
  params.gustAmp = finiteOr(params.gustAmp, DEFAULTS.gustAmp);
  params.dragCoeff = finiteOr(params.dragCoeff, DEFAULTS.dragCoeff);
  params.padX = finiteOr(params.padX, DEFAULTS.padX);
  params.padHalf = finiteOr(params.padHalf, DEFAULTS.padHalf);
  params.fuel0 = Math.max(0, finiteOr(params.fuel0, DEFAULTS.fuel0));

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
      throttleActual: 0,
      gimbalActual: 0,
    },
    params,
  };
}

/** One immutable semi-implicit Euler physics step. */
export function stepPhysics(state, control, params) {
  const dt = DT;
  const throttle = clamp(finiteOr(control?.throttle, 0), 0, 1);
  const gimbal = clamp(finiteOr(control?.gimbal, 0), -0.35, 0.35);
  const throttleActual = state.throttleActual +
    (throttle - state.throttleActual) * (1 - Math.exp(-dt / 0.18));
  const gimbalActual = state.gimbalActual +
    (gimbal - state.gimbalActual) * (1 - Math.exp(-dt / 0.12));
  const u = state.fuel > 0 ? throttleActual : 0;
  const delta = gimbalActual;
  const fuelRatio = clamp(state.fuel / params.fuel0, 0, 1);
  const aT = params.aMax * u * (1.12 - 0.12 * fuelRatio);
  const wind = params.windAmp * Math.sin(0.07 * state.t + params.phase) +
    params.gustAmp * Math.sin(2.3 * state.t + 0.5 * params.phase);
  const ax = aT * Math.sin(state.theta + delta) + wind -
    params.dragCoeff * state.vx * Math.abs(state.vx);
  const ay = aT * Math.cos(state.theta + delta) - params.g -
    params.dragCoeff * state.vy * Math.abs(state.vy);
  const omega = state.omega + dt * (params.K * u * delta - params.C * state.omega);
  const theta = state.theta + dt * omega;
  const vx = state.vx + dt * ax;
  const x = state.x + dt * vx;
  const vy = state.vy + dt * ay;
  const y = state.y + dt * vy;
  const fuel = Math.max(0, state.fuel - 0.045 * u * dt);

  return {
    t: state.t + dt,
    x,
    y,
    vx,
    vy,
    theta,
    omega,
    fuel,
    throttleActual,
    gimbalActual,
  };
}

function round2(value) {
  const rounded = Number(value.toFixed(2));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function makeSensor(state, params) {
  return {
    t: round2(state.t),
    altitude: round2(state.y),
    xOffset: round2(state.x - params.padX),
    theta: round2(state.theta),
    fuel: round2(state.fuel),
  };
}

export function classify(state, params) {
  if (Math.abs(state.theta) > Math.PI / 2) return "tip-over";
  if (Math.abs(state.x) > 80 || state.y > 180) return "out-of-bounds";
  if (state.t >= 20) return "timeout";
  if (state.y > 0) return "flying";
  if (Math.abs(state.x - params.padX) > params.padHalf) return "off-pad";
  if (Math.abs(state.theta) > 8 * Math.PI / 180 ||
      Math.abs(state.omega) > 15 * Math.PI / 180) return "tip-over";
  if (Math.abs(state.vx) > 2 || Math.abs(state.vy) > 3) return "hard-crash";
  return "landed";
}

export { DT };
