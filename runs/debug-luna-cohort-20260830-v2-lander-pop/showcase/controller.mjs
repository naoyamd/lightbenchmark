const LIMIT_GIMBAL = 0.35;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// A deliberately small, history-only guidance computer.  It never sees the
// simulator state: both velocity estimates are finite differences of sensors.
export function createController() {
  let previous = null;
  let previousPrevious = null;
  let lastCommand = { throttle: 1, gimbal: 0 };
  let sampleCount = 0;

  const estimate = (sensor, key) => {
    if (!previous) return 0;
    const dt = Math.max(0.08, sensor.t - previous.t);
    const first = (sensor[key] - previous[key]) / dt;
    if (!previousPrevious) return first;
    const oldDt = Math.max(0.08, previous.t - previousPrevious.t);
    const older = (previous[key] - previousPrevious[key]) / oldDt;
    // Sensor values are quantized to centimetres/radians; averaging makes
    // the derivative quiet enough for the attitude loop.
    return 0.65 * first + 0.35 * older;
  };

  const step = sensor => {
    const vx = estimate(sensor, "xOffset");
    const vy = estimate(sensor, "altitude");
    const omega = estimate(sensor, "theta");
    const altitude = sensor.altitude;
    const x = sensor.xOffset;
    const fuel = sensor.fuel;

    // A short, deterministic catch phase handles the high initial descent;
    // afterwards the velocity/altitude loop takes over smoothly.
    const catchPhase = sampleCount < 5 && altitude > 12;
    const speedCurve = 1.35 * Math.sqrt(Math.max(0, altitude));
    const targetSpeed = Math.min(9.5, Math.max(0.55, speedCurve));
    const targetVy = -targetSpeed;
    const velocityError = targetVy - vy;
    const nearGround = altitude < 18;
    // Estimate the hover fraction from the fuel-dependent thrust multiplier.
    // The small nominal constants keep this controller usable across the
    // exercise's parameter band without receiving hidden physics values.
    const fuelRatioGuess = clamp(fuel / 0.65, 0, 1);
    const hoverBias = 0.446 / (1.12 - 0.12 * fuelRatioGuess);
    let throttle = hoverBias + 0.088 * velocityError;
    if (altitude < 1.5 && vy > -0.6) throttle -= 0.04;
    if (catchPhase) throttle = 1;
    throttle = clamp(throttle, 0, 1);

    // Horizontal guidance asks for a gentle acceleration toward pad centre.
    // The desired lean is intentionally modest so the touchdown attitude
    // margin remains comfortable even with actuator lag.
    const horizontalAcceleration = clamp(-0.22 * x - 0.58 * vx, -3.8, 3.8);
    const desiredTheta = clamp(horizontalAcceleration / 10.5, -0.30, 0.30);
    const attitudeError = desiredTheta - sensor.theta;
    let gimbal = 0.82 * attitudeError - 0.92 * omega;
    // Once nearly stationary over the pad, privilege upright recovery.
    if (nearGround) gimbal += -0.12 * sensor.theta - 0.08 * omega;
    gimbal = clamp(gimbal, -LIMIT_GIMBAL, LIMIT_GIMBAL);

    previousPrevious = previous;
    previous = { ...sensor };
    sampleCount += 1;
    lastCommand = { throttle, gimbal };
    return { ...lastCommand };
  };

  return { step };
}
