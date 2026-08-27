const MAX_GIMBAL = 0.35;
const NOMINAL_G = 9.81;
const NOMINAL_A_MAX = 22;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function estimate(previous, sensor) {
  if (!previous) return { vx: 0, vy: -18, omega: 0 };
  const dt = Math.max(0.1, sensor.t - previous.t);
  return {
    vx: (sensor.xOffset - previous.xOffset) / dt,
    vy: (sensor.altitude - previous.altitude) / dt,
    omega: (sensor.theta - previous.theta) / dt,
  };
}

export function createController() {
  let previous;

  return {
    step(sensor) {
      const { vx, vy, omega } = estimate(previous, sensor);
      previous = { ...sensor };

      const altitude = Math.max(0, sensor.altitude);
      const targetVy = -(2.2 + Math.min(10, 0.8 * Math.sqrt(altitude)));
      const tilt = sensor.theta;
      const desiredAy = 1.3 * (targetVy - vy);
      let throttle = (NOMINAL_G + desiredAy) / (NOMINAL_A_MAX * Math.max(0.82, Math.cos(tilt)));
      if (altitude < 14) throttle += 0.08;
      if (altitude < 5 && vy > -1.5) throttle -= 0.06;
      throttle = clamp(throttle, 0, 1);

      const timeToGround = clamp(altitude / Math.max(3, -vy), 1.5, 8);
      const desiredVx = clamp(-sensor.xOffset / timeToGround, -8, 8);
      const desiredAx = clamp(1.25 * (desiredVx - vx), -9, 9);
      const thrust = Math.max(8, NOMINAL_A_MAX * Math.max(throttle, 0.35));
      const directionLimit = altitude < 6 ? 0.1 + 0.02 * altitude : 0.55;
      const desiredDirection = Math.asin(clamp(desiredAx / thrust, -directionLimit, directionLimit));
      const gimbal = clamp(desiredDirection - tilt - 1.15 * omega, -MAX_GIMBAL, MAX_GIMBAL);

      // Keep a little vertical thrust while fuel remains; the simulator clamps both fields.
      if (sensor.fuel <= 0) return { throttle: 0, gimbal: 0 };
      return { throttle, gimbal };
    },
  };
}

export default { createController };
