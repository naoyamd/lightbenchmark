import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { forward, inverse, planSort } from "./submission/site/arm.mjs";

const scenario = JSON.parse(await readFile("./submission/site/scenario.json", "utf8"));
const close = (a, b, epsilon = 1e-7) => Math.abs(a - b) <= epsilon;
const home = forward(scenario.spec.home, scenario.spec);
assert.ok(close(home.tool[0], 0));
assert.ok(close(home.tool[1], 270));

for (const target of scenario.items.flatMap(item => [item.pickup, item.target])) {
  const solutions = [inverse(target, scenario.spec, "up"), inverse(target, scenario.spec, "down")].filter(Boolean);
  assert.ok(solutions.length > 0, `reachable target ${target}`);
  assert.ok(solutions.some(joints => {
    const tool = forward(joints, scenario.spec).tool;
    return close(tool[0], target[0]) && close(tool[1], target[1]);
  }));
}

const first = planSort(structuredClone(scenario));
const second = planSort(structuredClone(scenario));
assert.deepEqual(first, second, "planSort must be deterministic");
assert.ok(Array.isArray(first) && first.length >= 13);
assert.deepEqual(first[0], { t: 0, joints: scenario.spec.home, grip: false });
for (let index = 1; index < first.length; index += 1) {
  const before = first[index - 1];
  const frame = first[index];
  assert.ok(Number.isFinite(frame.t) && frame.t > before.t);
  assert.equal(typeof frame.grip, "boolean");
  assert.equal(frame.joints.length, 2);
  const dt = frame.t - before.t;
  frame.joints.forEach((angle, joint) => {
    assert.ok(angle >= scenario.spec.jointLimits[joint][0] && angle <= scenario.spec.jointLimits[joint][1]);
    assert.ok(Math.abs(angle - before.joints[joint]) / dt <= scenario.spec.maxSpeeds[joint] + 1e-9);
  });
}
assert.equal(first.at(-1).grip, false);

console.log("Robot Arm Sort public tests passed");
