import assert from "node:assert/strict";
import {
  applyAlgorithm,
  applyMove,
  createSolved,
  generateScramble,
  invertAlgorithm,
  isSolved,
  serialize,
} from "./submission/site/engine.mjs";

const moves = ["U", "R", "F", "D", "L", "B"];
const solved = createSolved();
assert.ok(solved instanceof Uint8Array);
assert.equal(solved.length, 54);
assert.equal(isSolved(solved), true);

for (const move of moves) {
  assert.deepEqual(applyAlgorithm(solved, [move, move, move, move]), solved);
  assert.deepEqual(applyAlgorithm(solved, [move, `${move}'`]), solved);
  assert.deepEqual(applyAlgorithm(solved, [`${move}2`, `${move}2`]), solved);
}

const before = serialize(solved);
assert.throws(() => applyAlgorithm(solved, ["R", "NOPE"]));
assert.equal(serialize(solved), before, "invalid algorithms must be atomic");
assert.notDeepEqual(applyMove(solved, "R"), solved);

const scramble = generateScramble(0x00c0ffee, 25);
assert.equal(scramble.length, 25);
const axis = (token) => ({ U: "y", D: "y", R: "x", L: "x", F: "z", B: "z" })[token[0]];
for (let i = 1; i < scramble.length; i += 1) {
  assert.notEqual(axis(scramble[i - 1]), axis(scramble[i]));
}
const mixed = applyAlgorithm(solved, scramble);
assert.equal(isSolved(mixed), false);
assert.equal(isSolved(applyAlgorithm(mixed, invertAlgorithm(scramble))), true);

console.log("Prism Twist public tests passed");
