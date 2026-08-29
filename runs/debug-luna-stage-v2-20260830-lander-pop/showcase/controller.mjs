const MAX_GIMBAL = 0.35;
const MAX_THROTTLE = 1;
const DT_CONTROL = 0.1;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function createHistoryEstimator() {
  const history = [];
  const commandHistory = [];
  const keep = 18;

  function push(sensor) {
    const sample = {
      t: finite(sensor?.t),
      altitude: finite(sensor?.altitude),
      xOffset: finite(sensor?.xOffset),
      theta: finite(sensor?.theta),
      fuel: finite(sensor?.fuel),
    };
    history.push(sample);
    if (history.length > keep) history.shift();
    return sample;
  }

  function slope(key, span = 1) {
    if (history.length < 2) return 0;
    const end = history[history.length - 1];
    const start = history[Math.max(0, history.length - 1 - span)];
    const dt = end.t - start.t;
    return dt > 0 ? (end[key] - start[key]) / dt : 0;
  }

  function filteredSlope(key) {
    if (history.length < 3) return slope(key, 1);
    const spans = [1, 2, 3].map((span) => slope(key, span));
    return spans[0] * 0.5 + spans[1] * 0.3 + spans[2] * 0.2;
  }

  function rememberCommand(command) {
    commandHistory.push({ ...command });
    if (commandHistory.length > keep) commandHistory.shift();
  }

  return {
    push,
    slope,
    filteredSlope,
    rememberCommand,
    get history() { return history; },
  };
}

/**
 * A deliberately small sensor-only guidance loop.  It uses finite differences
 * of the sampled sensor stream for all velocity and angular-rate estimates.
 */
export function createController() {
  const estimator = createHistoryEstimator();
  let lastThrottle = 0;
  let lastGimbal = 0;
  let mode = "boost";
  let initialFuel = null;

  function step(sensor) {
    const s = estimator.push(sensor);
    const age = Math.max(0, s.t);
    const altitude = Math.max(0, s.altitude);
    const x = s.xOffset;
    const verticalVelocity = estimator.filteredSlope("altitude");
    const horizontalVelocity = estimator.filteredSlope("xOffset");
    const angularVelocity = estimator.filteredSlope("theta");
    const fuel = Math.max(0, s.fuel);
    if (initialFuel === null) initialFuel = Math.max(0.001, fuel);
    const fuelFraction = clamp(fuel / initialFuel, 0, 1);

    // A soft, altitude-based descent profile.  The profile asks for a slower
    // terminal descent while leaving enough authority for uncertain gravity.
    const desiredDescent = -clamp(3.0 + 0.8 * Math.sqrt(altitude), 3.0, 9.0);
    const verticalError = desiredDescent - verticalVelocity;
    let throttle;

    if (age < 0.18 && altitude > 75) {
      mode = "boost";
      throttle = 0.98;
    } else if (altitude > 62) {
      mode = "brake";
      throttle = 0.48 + 0.05 * verticalError;
    } else if (altitude > 24) {
      mode = "approach";
      throttle = 0.49 + 0.055 * verticalError;
    } else {
      mode = "landing";
      throttle = 0.47 + 0.07 * verticalError;
    }

    // Estimate remaining vertical authority conservatively as fuel gets low.
    // This is intentionally based only on the observed fuel value.
    throttle += altitude < 15 ? 0.07 : 0;
    if (fuelFraction < 0.18) throttle -= 0.08;
    throttle = clamp(throttle, 0, MAX_THROTTLE);

    // Position-to-velocity guidance.  Horizontal motion is made gentle near
    // the pad; at altitude, a capped desired velocity moves the initial craft
    // back toward the landing corridor without large attitude excursions.
    const positionGain = altitude > 55 ? 0.18 : altitude > 18 ? 0.32 : 0.55;
    const maxDesired = altitude > 45 ? 6 : altitude > 16 ? 3.2 : 1.2;
    const desiredHorizontalVelocity = clamp(-x * positionGain, -maxDesired, maxDesired);
    const lateralError = desiredHorizontalVelocity - horizontalVelocity;

    // First choose a small attitude target for horizontal acceleration.  Then
    // invert the simple angular-rate dynamics with a PD term.  This keeps the
    // commanded gimbal small enough that the vehicle does not wind up while
    // the gimbal actuator is still catching up.
    const desiredLateralAcceleration = clamp(0.52 * lateralError, -2.2, 2.2);
    const thrustEstimate = Math.max(8, 21 * Math.max(0.42, lastThrottle));
    let targetTheta = clamp(desiredLateralAcceleration / thrustEstimate, -0.105, 0.105);
    if (altitude < 22) targetTheta *= clamp(altitude / 22, 0, 1);
    if (altitude < 8) targetTheta *= 0.35;
    const targetOmega = clamp(2.1 * (targetTheta - s.theta), -0.22, 0.22);
    const desiredAngularAcceleration = 4.2 * (targetOmega - angularVelocity);
    const estimatedU = Math.max(0.22, lastThrottle);
    let gimbal = (desiredAngularAcceleration + 0.8 * angularVelocity) / (8 * estimatedU);
    gimbal = clamp(gimbal, -MAX_GIMBAL, MAX_GIMBAL);

    // Do not thrash the actuators on rounded, nearly stationary measurements.
    // The tiny slew limit is a control choice, not a physics shortcut.
    const maxThrottleChange = mode === "landing" ? 0.24 : 0.32;
    throttle = clamp(lastThrottle + clamp(throttle - lastThrottle, -maxThrottleChange, maxThrottleChange), 0, 1);
    gimbal = clamp(lastGimbal + clamp(gimbal - lastGimbal, -0.18, 0.18), -MAX_GIMBAL, MAX_GIMBAL);

    // Let the first few samples establish derivative history while retaining
    // useful initial braking authority.
    if (estimator.history.length < 2) {
      throttle = altitude > 70 ? 1 : throttle;
      gimbal = clamp(-0.04 * x - 0.5 * s.theta, -0.2, 0.2);
    }

    // A short final hover bias protects against the rounded sensor crossing
    // zero early.  It still depends on observed altitude and descent rate.
    if (altitude < 5 && verticalVelocity < -1.8) throttle = Math.max(throttle, 0.55);

    const command = {
      throttle: clamp(finite(throttle), 0, 1),
      gimbal: clamp(finite(gimbal), -MAX_GIMBAL, MAX_GIMBAL),
    };
    lastThrottle = command.throttle;
    lastGimbal = command.gimbal;
    estimator.rememberCommand(command);
    return command;
  }

  return { step };
}
