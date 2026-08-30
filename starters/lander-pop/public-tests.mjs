import assert from "node:assert/strict";
import { createController } from "./submission/site/controller.mjs";
import { classify, makeSensor, stepPhysics } from "./submission/site/sim.mjs";

const PUBLIC_STATE = {
  t: 0,
  x: -4.848067389801145,
  y: 93.528570109047,
  vx: -2.5883225183933973,
  vy: -20.121918114367872,
  theta: -0.019816360780969267,
  omega: -0.005490666888654239,
  fuel: 0.65,
  throttleActual: 0,
  gimbalActual: 0,
};
const PUBLIC_PARAMS = {
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
  phase: 2.503617682388614,
};

const stateCopy = structuredClone(PUBLIC_STATE);
const next = stepPhysics(PUBLIC_STATE, { throttle: 0, gimbal: 0 }, PUBLIC_PARAMS);
assert.deepEqual(PUBLIC_STATE, stateCopy, "stepPhysics must not mutate its input");
assert.equal(next.t, PUBLIC_STATE.t + 0.02);
assert.ok(next.vy < PUBLIC_STATE.vy);

const lagged = stepPhysics(PUBLIC_STATE, { throttle: 1, gimbal: 0.35 }, PUBLIC_PARAMS);
assert.ok(lagged.throttleActual > 0 && lagged.throttleActual < 1);
assert.ok(lagged.gimbalActual > 0 && lagged.gimbalActual < 0.35);

assert.deepEqual(Object.keys(makeSensor(PUBLIC_STATE, PUBLIC_PARAMS)).sort(), [
  "altitude",
  "fuel",
  "t",
  "theta",
  "xOffset",
]);

const controller = createController();
assert.equal(typeof controller.step, "function");
const control = controller.step(makeSensor(PUBLIC_STATE, PUBLIC_PARAMS));
assert.ok(control.throttle >= 0 && control.throttle <= 1);
assert.ok(control.gimbal >= -0.35 && control.gimbal <= 0.35);

let state = structuredClone(PUBLIC_STATE);
let command = { throttle: 0, gimbal: 0 };
let status = "flying";
const autopilot = createController();
for (let physicsStep = 0; physicsStep < 1000 && status === "flying"; physicsStep += 1) {
  if (physicsStep % 5 === 0) command = autopilot.step(makeSensor(state, PUBLIC_PARAMS));
  state = stepPhysics(state, command, PUBLIC_PARAMS);
  status = classify(state, PUBLIC_PARAMS);
}
assert.equal(status, "landed", "the public scenario must land safely");

console.log("Lander Pop public tests passed");
