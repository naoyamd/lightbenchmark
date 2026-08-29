import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import * as cube from "../evaluator/cube.mjs";
import * as puyo from "../evaluator/puyo.mjs";
import * as rocket from "../evaluator/rocket.mjs";
import {
  evaluateCubeModule,
  evaluatePuyoModule,
  evaluateRocketModules,
  evaluateSubmission,
} from "../scripts/evaluate-submission.mjs";

const challenge = JSON.parse(await readFile(new URL("../evaluator/fixtures/puyo-18.json", import.meta.url), "utf8"));

test("reference engines qualify against the independent evaluator", async () => {
  const puyoResult = await evaluatePuyoModule(puyo, challenge);
  const cubeResult = await evaluateCubeModule(cube);
  assert.equal(puyoResult.pass, true);
  assert.equal(cubeResult.pass, true);
});

test("rocket evaluator separates physics correctness from controller outcome", async () => {
  const controller = { createController: () => ({ step: () => ({ throttle: 0, gimbal: 0 }) }) };
  const result = await evaluateRocketModules(rocket, controller);
  assert.equal(result.logicPass, true);
  assert.equal(result.headlinePass, false);
  assert.equal(result.robustnessPass, true);
  assert.equal(result.landings.length, 8);
  assert.ok(result.landings.every(({ status, landingTime, fuel, safetyMargin }) => (
    typeof status === "string"
    && typeof landingTime === "number"
    && typeof fuel === "number"
    && safetyMargin && typeof safetyMargin.pad === "number"
  )));
  assert.notEqual(result.landings[0].status, "landed");
});

test("rocket controller rejects direct simulator imports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lightbenchmark-controller-"));
  try {
    await writeFile(path.join(root, "controller.mjs"), `
      import * as sim from "./sim.mjs";
      export function createController() { return { step: () => ({ throttle: sim ? 0 : 1, gimbal: 0 }) }; }
    `, "utf8");
    const result = await evaluateSubmission("lander-pop", root);
    assert.equal(result.pass, false);
    assert.equal(result.logicPass, false);
    assert.match(result.checks[0].detail, /must not import sim\.mjs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("all reference candidates qualify through permission-limited processes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lightbenchmark-candidate-"));
  try {
    const cubeDirectory = path.join(root, "cube");
    const puyoDirectory = path.join(root, "puyo");
    const rocketDirectory = path.join(root, "rocket");
    await Promise.all([cubeDirectory, puyoDirectory, rocketDirectory].map(directory => mkdir(directory)));
    await Promise.all([
      cp(new URL("../evaluator/cube.mjs", import.meta.url), path.join(cubeDirectory, "engine.mjs")),
      cp(new URL("../evaluator/puyo.mjs", import.meta.url), path.join(puyoDirectory, "engine.mjs")),
      cp(new URL("../evaluator/fixtures/puyo-18.json", import.meta.url), path.join(puyoDirectory, "challenge.json")),
      cp(new URL("../evaluator/rocket.mjs", import.meta.url), path.join(rocketDirectory, "sim.mjs")),
      cp(new URL("../evaluator/rocket-reference-controller.mjs", import.meta.url), path.join(rocketDirectory, "controller.mjs")),
    ]);
    const [cubeResult, puyoResult, rocketResult] = await Promise.all([
      evaluateSubmission("prism-twist", cubeDirectory),
      evaluateSubmission("color-cascade-18", puyoDirectory),
      evaluateSubmission("lander-pop", rocketDirectory),
    ]);
    assert.equal(cubeResult.pass, true);
    assert.equal(puyoResult.pass, true);
    assert.equal(rocketResult.pass, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate cannot read a sealed file outside its submission", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lightbenchmark-candidate-"));
  const secret = path.join(path.dirname(root), `${path.basename(root)}-sealed.txt`);
  const marker = `sealed-${Date.now()}`;
  try {
    await writeFile(secret, marker, "utf8");
    await writeFile(path.join(root, "engine.mjs"), `
      import { readFileSync } from "node:fs";
      const probe = () => { throw new Error("candidate-read:" + readFileSync(${JSON.stringify(secret)}, "utf8")); };
      export const createSolved = probe;
      export const applyMove = probe;
      export const applyAlgorithm = probe;
      export const invertAlgorithm = probe;
      export const isSolved = probe;
      export const generateScramble = probe;
      export const serialize = probe;
    `, "utf8");
    const result = await evaluateSubmission("prism-twist", root);
    assert.equal(result.pass, false);
    assert.equal(JSON.stringify(result).includes(marker), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(secret, { force: true });
  }
});
