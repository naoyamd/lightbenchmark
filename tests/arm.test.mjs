import assert from "node:assert/strict";
import test from "node:test";
import { SPEC, configurationSafe, createScenario, forward, inverse, planSort, simulatePlan } from "../evaluator/arm.mjs";

const close = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

test("arm FK and valid IK branches agree", () => {
  for (const target of [[190, 45], [-188, 48], [160, 92]]) {
    let branches = 0;
    for (const elbow of ["up", "down"]) {
      const joints = inverse(target, SPEC, elbow);
      if (!joints) continue;
      branches += 1;
      const tool = forward(joints, SPEC).tool;
      assert.ok(close(tool[0], target[0]));
      assert.ok(close(tool[1], target[1]));
    }
    assert.ok(branches > 0);
  }
  assert.equal(inverse([500, 500], SPEC, "up"), null);
});

test("arm planner is deterministic and sorts without collision", () => {
  for (const seed of [0, 1, 0x12345678, 0xffffffff]) {
    const scenario = createScenario(seed);
    const first = planSort(scenario);
    assert.deepEqual(first, planSort(scenario));
    const result = simulatePlan(scenario, first);
    assert.equal(result.pass, true, result.errors.join("; "));
    assert.deepEqual(result.sorted.sort(), scenario.items.map(item => item.id).sort());
  }
});

test("arm collision checks include links and carried-item clearance", () => {
  const scenario = createScenario(0x12345678);
  assert.equal(configurationSafe(scenario.spec.home, scenario), true);
  const target = ["up", "down"].map(elbow => inverse([186, 48], scenario.spec, elbow)).find(joints => joints && configurationSafe(joints, scenario, true));
  assert.ok(target);
  assert.equal(configurationSafe([0.2, 1.5], scenario, true), false);
});
