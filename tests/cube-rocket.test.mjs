import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyAlgorithm,
  applyMove,
  createSolved,
  generateScramble,
  invertAlgorithm,
  isSolved,
  serialize,
} from "../evaluator/cube.mjs";
import {
  DEFAULT_PARAMS,
  classify,
  createScenario,
  makeSensor,
  runController,
  stepPhysics,
} from "../evaluator/rocket.mjs";
import { createController as createReferenceController } from "../evaluator/rocket-reference-controller.mjs";

const MOVES = ["U", "R", "F", "D", "L", "B"];
const AXIS = { U: "y", D: "y", R: "x", L: "x", F: "z", B: "z" };

test("cube moves obey group identities and preserve immutable states", () => {
  const solved = createSolved();
  const before = serialize(solved);
  assert.equal(isSolved(solved), true);
  for (const move of MOVES) {
    assert.equal(isSolved(applyAlgorithm(solved, [move, move, move, move])), true);
    assert.equal(isSolved(applyAlgorithm(solved, [move, `${move}'`])), true);
    assert.equal(isSolved(applyAlgorithm(solved, [`${move}2`, `${move}2`])), true);
    assert.notEqual(applyMove(solved, move), solved);
  }
  assert.equal(serialize(solved), before);

  for (const seed of [0, 1, 0x00c0ffee, 0x12345678, 0xffffffff]) {
    const scramble = generateScramble(seed, 25);
    assert.equal(scramble.length, 25);
    for (let i = 1; i < scramble.length; i += 1) {
      assert.notEqual(AXIS[scramble[i - 1][0]], AXIS[scramble[i][0]]);
    }
    const mixed = applyAlgorithm(solved, scramble);
    assert.equal(isSolved(applyAlgorithm(mixed, invertAlgorithm(scramble))), true);
    for (let face = 0; face < 6; face += 1) {
      assert.equal(mixed.filter((value) => value === face).length, 9);
      assert.equal(mixed[face * 9 + 4], face);
    }
  }
});

test("cube algorithms validate atomically and invert strings", () => {
  const solved = createSolved();
  const before = serialize(solved);
  assert.throws(() => applyAlgorithm(solved, ["R", "NOPE", "U"]));
  assert.equal(serialize(solved), before);
  assert.equal(invertAlgorithm("R U2 F'"), "F U2 R'");
  assert.equal(isSolved(applyAlgorithm(solved, "R U2 F' F U2 R'")), true);
});

test("rocket scenarios are deterministic and expose phase in params", () => {
  const first = createScenario(0x5eed1234);
  const second = createScenario(0x5eed1234);
  assert.deepEqual(first, second);
  assert.equal(typeof first.params.phase, "number");
  assert.deepEqual(Object.keys(makeSensor(first.state, first.params)).sort(), [
    "altitude", "fuel", "t", "theta", "xOffset",
  ]);
  assert.throws(() => createScenario(1, { g: 9.39 }));
  assert.throws(() => createScenario(1, { padHalf: 6.51 }));
  assert.doesNotThrow(() => createScenario(1, { g: 9.4, padHalf: 6.5, fuel0: 0.55 }));
});

test("rocket step uses the specified semi-implicit equations and clamps control", () => {
  const state = { t: 0, x: 1, y: 10, vx: 2, vy: -3, theta: 0.1, omega: 0.2, fuel: 0.5 };
  const params = { ...DEFAULT_PARAMS, phase: 0, windAmp: 0 };
  const control = { throttle: 1.2, gimbal: 0.4 };
  const next = stepPhysics(state, control, params);
  const u = 1 - Math.exp(-0.02 / 0.18);
  const delta = 0.35 * (1 - Math.exp(-0.02 / 0.12));
  const aT = 22 * u * (1.12 - 0.12 * (0.5 / 0.65));
  const ax = aT * Math.sin(0.1 + delta) - 0.0025 * 2 * Math.abs(2);
  const ay = aT * Math.cos(0.1 + delta) - 9.81 - 0.0025 * (-3) * Math.abs(-3);
  const omega = 0.2 + 0.02 * (8 * u * delta - 0.8 * 0.2);
  assert.equal(next.t, 0.02);
  assert.equal(next.throttleActual, u);
  assert.equal(next.gimbalActual, delta);
  assert.ok(Math.abs(next.omega - omega) < 1e-12);
  assert.ok(Math.abs(next.theta - (0.1 + 0.02 * omega)) < 1e-12);
  assert.ok(Math.abs(next.vx - (2 + 0.02 * ax)) < 1e-12);
  assert.ok(Math.abs(next.x - (1 + 0.02 * next.vx)) < 1e-12);
  assert.ok(Math.abs(next.vy - (-3 + 0.02 * ay)) < 1e-12);
  assert.ok(Math.abs(next.y - (10 + 0.02 * next.vy)) < 1e-12);
  assert.ok(Math.abs(next.fuel - (0.5 - 0.045 * u * 0.02)) < 1e-12);
  assert.deepEqual(state, { t: 0, x: 1, y: 10, vx: 2, vy: -3, theta: 0.1, omega: 0.2, fuel: 0.5 });

  const sensor = makeSensor({ ...state, t: 1.234, y: 12.345, x: 2.345, theta: -0.126, fuel: 0.654 }, params);
  assert.deepEqual(sensor, { t: 1.23, altitude: 12.35, xOffset: 2.35, theta: -0.13, fuel: 0.65 });
});

test("rocket classification follows terminal-state priority", () => {
  const p = { ...DEFAULT_PARAMS, phase: 0 };
  const base = { t: 1, x: 0, y: 10, vx: 0, vy: 0, theta: 0, omega: 0, fuel: 0.5 };
  assert.equal(classify({ ...base, theta: Math.PI / 2 + 0.01, x: 81, y: 181, t: 20 }, p), "tip-over");
  assert.equal(classify({ ...base, x: 81 }, p), "out-of-bounds");
  assert.equal(classify({ ...base, t: 20 }, p), "timeout");
  assert.equal(classify(base, p), "flying");
  assert.equal(classify({ ...base, y: 0, x: 7 }, p), "off-pad");
  assert.equal(classify({ ...base, y: 0, theta: 9 * Math.PI / 180 }, p), "tip-over");
  assert.equal(classify({ ...base, y: 0, omega: 16 * Math.PI / 180 }, p), "tip-over");
  assert.equal(classify({ ...base, y: 0, vy: -4 }, p), "hard-crash");
  assert.equal(classify({ ...base, y: 0, vy: -3 }, p), "landed");
});

test("runController holds each command for five physics steps", () => {
  const result = runController(0x5eed1234, { step: () => ({ throttle: 0, gimbal: 0 }) });
  assert.ok(result.telemetry.length > 0);
  assert.ok(result.telemetry.length <= 1000);
  assert.deepEqual(Object.keys(result.telemetry[0].sensor).sort(), [
    "altitude", "fuel", "t", "theta", "xOffset",
  ]);
  if (result.telemetry.length >= 5) {
    assert.equal(result.telemetry[0].control.throttle, result.telemetry[4].control.throttle);
    assert.equal(result.telemetry[0].control.gimbal, result.telemetry[4].control.gimbal);
  }
});

test("rocket reference controller lands the public qualification scenarios", () => {
  const publicResult = runController(0x5eed1234, createReferenceController);
  assert.equal(publicResult.status, "landed");

  const qualificationScenarios = [
    { seed: 0x5eed1234, overrides: {} },
    { seed: 0x12345678, overrides: { g: 9.4 } },
    { seed: 0x9abcdef0, overrides: { aMax: 23.5 } },
    { seed: 0x10203040, overrides: { windAmp: 0.4, gustAmp: 0.2, padX: -10 } },
    { seed: 0xdeadbeef, overrides: { g: 10.2, aMax: 20.5, fuel0: 0.55 } },
    {
      seed: 0xcafebabe,
      overrides: { g: 9.4, aMax: 23.5, windAmp: 0.4, padX: 10, padHalf: 5.5, fuel0: 0.75 },
    },
    { seed: 0x0badf00d, overrides: { dragCoeff: 0.01, gustAmp: 0.2 } },
    { seed: 0xffffffff, overrides: { g: 10.2, dragCoeff: 0.01, padX: -8 } },
  ];
  const results = qualificationScenarios.map(({ seed, overrides }) => (
    runController(seed, createReferenceController, overrides)
  ));
  const landed = results.filter(({ status }) => status === "landed").length;
  assert.ok(landed >= Math.ceil(qualificationScenarios.length * 0.8), `${landed}/${qualificationScenarios.length} qualification scenarios landed: ${results.map(({ status }) => status)}`);
});
