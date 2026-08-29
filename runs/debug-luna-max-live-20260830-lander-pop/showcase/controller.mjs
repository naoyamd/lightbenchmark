const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

// The controller only keeps a short, rounded sensor history.  Velocity is
// deliberately reconstructed from observations rather than being supplied by
// the simulator.
export function createController() {
  const history = [];
  let lastCommand = { throttle: 0, gimbal: 0 };

  function slope(field, window = 4) {
    if (history.length < 2) return 0;
    const newest = history[history.length - 1];
    const oldest = history[Math.max(0, history.length - 1 - window)];
    const dt = newest.t - oldest.t;
    return dt > 0 ? (newest[field] - oldest[field]) / dt : 0;
  }

  function step(sensor) {
    const observation = {
      t: Number(sensor.t) || 0,
      altitude: Number(sensor.altitude) || 0,
      xOffset: Number(sensor.xOffset) || 0,
      theta: Number(sensor.theta) || 0,
      fuel: Number(sensor.fuel) || 0,
    };
    history.push(observation);
    if (history.length > 12) history.shift();

    const vx = slope("xOffset", 4);
    const vy = slope("altitude", 4);
    const omega = slope("theta", 5);
    const altitude = observation.altitude;

    // A speed envelope gives the vehicle room to brake high up and asks for a
    // gentle final descent close to the pad.  The feedback term adapts to the
    // permitted gravity/thrust variations without knowing those parameters.
    const envelope = Math.min(15, 1.2 + 1.18 * Math.sqrt(Math.max(0, altitude)));
    const finalTarget = altitude < 7 ? 0.9 + 0.45 * Math.sqrt(Math.max(0, altitude)) : envelope;
    const targetVy = -Math.max(0.85, finalTarget);
    const verticalGain = altitude < 10 ? 1.8 : 1.15;
    let throttle = (9.8 + verticalGain * (targetVy - vy)) / 22;
    if (altitude < 3.5 && vy < -2.2) throttle += 0.18;
    throttle = clamp(throttle, 0, 1);

    // First request a lateral acceleration from position and estimated speed,
    // then use the gimbal as an attitude actuator.  Keeping the requested tilt
    // modest leaves margin for the landing attitude limits.
    const lateralAcceleration = clamp(-0.16 * observation.xOffset - 0.65 * vx, -3.6, 3.6);
    const thrust = Math.max(8, 22 * throttle);
    const targetTilt = clamp(Math.atan2(lateralAcceleration, thrust), -0.28, 0.28);
    const gimbal = clamp(1.8 * (targetTilt - observation.theta) - 0.65 * omega, -0.35, 0.35);

    lastCommand = { throttle, gimbal };
    return { ...lastCommand };
  }

  return { step };
}
