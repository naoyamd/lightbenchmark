import assert from "node:assert/strict";
import { createController } from "./submission/site/controller.mjs";
import { classify, createScenario, makeSensor, stepPhysics } from "./submission/site/sim.mjs";

const first = createScenario(0x5eed1234);
const second = createScenario(0x5eed1234);
assert.deepEqual(first, second, "same seed must create the same scenario");
assert.ok(first.state && first.params);

const stateCopy = structuredClone(first.state);
const next = stepPhysics(first.state, { throttle: 0, gimbal: 0 }, first.params);
assert.deepEqual(first.state, stateCopy, "stepPhysics must not mutate its input");
assert.equal(next.t, first.state.t + 0.02);
assert.ok(next.vy < first.state.vy);

assert.deepEqual(Object.keys(makeSensor(first.state, first.params)).sort(), [
  "altitude",
  "fuel",
  "t",
  "theta",
  "xOffset",
]);

const controller = createController();
assert.equal(typeof controller.step, "function");
const control = controller.step(makeSensor(first.state, first.params));
assert.ok(control.throttle >= 0 && control.throttle <= 1);
assert.ok(control.gimbal >= -0.35 && control.gimbal <= 0.35);

let { state, params } = createScenario(0x5eed1234);
let command = { throttle: 0, gimbal: 0 };
let status = "flying";
const autopilot = createController();
for (let physicsStep = 0; physicsStep < 1000 && status === "flying"; physicsStep += 1) {
  if (physicsStep % 5 === 0) command = autopilot.step(makeSensor(state, params));
  state = stepPhysics(state, command, params);
  status = classify(state, params);
}
assert.equal(status, "landed", "the public scenario must land safely");

console.log("Lander Pop public tests passed");
