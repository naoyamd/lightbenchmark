const DT = 0.02;
const RAD = Math.PI / 180;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const round2 = value => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/**
 * Advance the toy lander by one fixed physics tick.
 * The input objects are deliberately treated as immutable snapshots.
 */
export function stepPhysics(state, control, params) {
  const throttleTarget = clamp(Number(control?.throttle) || 0, 0, 1);
  const gimbalTarget = clamp(Number(control?.gimbal) || 0, -0.35, 0.35);
  const throttleActual = state.throttleActual +
    (throttleTarget - state.throttleActual) * (1 - Math.exp(-DT / 0.18));
  const gimbalActual = state.gimbalActual +
    (gimbalTarget - state.gimbalActual) * (1 - Math.exp(-DT / 0.12));
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

  const omega = state.omega + DT * (params.K * u * delta - params.C * state.omega);
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
    throttleActual,
    gimbalActual,
  };
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
  if (Math.abs(state.theta) > 8 * RAD || Math.abs(state.omega) > 15 * RAD) return "tip-over";
  if (Math.abs(state.vx) > 2 || Math.abs(state.vy) > 3) return "hard-crash";
  return "landed";
}
