import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RULES, dropPair, planChallenge, resolve } from "./submission/site/engine.mjs";

const empty = () => Array.from({ length: 14 }, () => Array(6).fill(0));

assert.deepEqual(RULES, { width: 6, height: 14, colors: 4, clearThreshold: 4 });

const single = empty();
single[0].splice(0, 4, 1, 1, 1, 1);
const original = structuredClone(single);
const cleared = resolve(single);
assert.equal(cleared.chainCount, 1);
assert.equal(cleared.steps[0].cleared.length, 4);
assert.ok(cleared.finalBoard.flat().every((cell) => cell === 0));
assert.deepEqual(single, original, "resolve must not mutate its input");

const dropped = dropPair(empty(), { x: 2, rotation: 0, colors: [1, 2] });
assert.equal(dropped.ok, true);
assert.equal(dropped.board[0][2], 1);
assert.equal(dropped.board[1][2], 2);

const challenge = JSON.parse(await readFile("./submission/site/challenge.json", "utf8"));
assert.deepEqual(Object.keys(challenge), ["seed", "goal"]);
assert.equal(challenge.goal.board.flat().filter(Boolean).length, 70);
const plan = planChallenge(structuredClone(challenge.goal), challenge.seed);
assert.equal(plan.setupPairs.length, 35);
assert.deepEqual(plan.triggerPair, challenge.goal.pair);
let plannedBoard = empty();
for (const pair of plan.setupPairs) {
  const step = dropPair(plannedBoard, pair);
  assert.equal(step.ok, true);
  assert.equal(resolve(step.board).chainCount, 0, "setup must not clear early");
  plannedBoard = step.board;
}
assert.deepEqual(plannedBoard, challenge.goal.board);
const droppedChallenge = dropPair(plannedBoard, plan.triggerPair);
assert.equal(droppedChallenge.ok, true);
assert.equal(droppedChallenge.board.flat().filter(Boolean).length, 72);
const result = resolve(droppedChallenge.board);
assert.equal(result.chainCount, 18);
assert.ok(result.steps.every((step) => step.cleared.length === 4));
assert.ok(result.finalBoard.flat().every((cell) => cell === 0));

console.log("Color Cascade public tests passed");
