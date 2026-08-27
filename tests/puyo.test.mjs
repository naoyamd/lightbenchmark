import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RULES, applyGravity, dropPair, findGroups, resolve } from "../evaluator/puyo.mjs";

const fixture = JSON.parse(await readFile(new URL("../evaluator/fixtures/puyo-18.json", import.meta.url), "utf8"));
const blank = () => Array.from({ length: RULES.height }, () => Array(RULES.width).fill(0));

test("RULES and oracle use the published board contract", () => {
  assert.deepEqual(RULES, { width: 6, height: 14, colors: 4, clearThreshold: 4 });
  const board = blank();
  board[0].splice(0, 4, 1, 1, 1, 1);
  board[1][5] = 1;
  board[2][5] = 1;

  const groups = findGroups(board);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], {
    color: 1,
    cells: [[0, 0], [1, 0], [2, 0], [3, 0]],
  });
});

test("resolve clears all qualifying groups together and applies y=0 gravity", () => {
  const board = blank();
  board[0].splice(0, 4, 1, 1, 1, 1);
  board[1][0] = 2;
  for (let y = 0; y < 4; y += 1) board[y][5] = 2;
  const original = board.map((row) => row.slice());

  const result = resolve(board);
  assert.equal(result.chainCount, 1);
  assert.equal(result.steps[0].groups.length, 2);
  assert.equal(result.steps[0].cleared.length, 8);
  assert.deepEqual(result.steps[0].cleared, [
    [0, 0], [1, 0], [2, 0], [3, 0], [5, 0], [5, 1], [5, 2], [5, 3],
  ]);
  assert.equal(result.finalBoard[0][0], 2);
  assert.equal(result.finalBoard[0][5], 0);
  assert.deepEqual(board, original);
  assert.equal(applyGravity(board)[0][0], 1);
});

test("dropPair locks each rotation and preserves its input", () => {
  const board = blank();
  const original = board.map((row) => row.slice());
  const up = dropPair(board, { x: 2, rotation: 0, colors: [1, 2] });
  assert.deepEqual(up, { ok: true, board: up.board });
  assert.equal(up.board[0][2], 1);
  assert.equal(up.board[1][2], 2);
  assert.deepEqual(board, original);

  const right = dropPair(board, { x: 2, rotation: 1, colors: [1, 2] });
  assert.equal(right.ok, true);
  assert.equal(right.board[0][2], 1);
  assert.equal(right.board[0][3], 2);

  const down = dropPair(board, { x: 2, rotation: 2, colors: [1, 2] });
  assert.equal(down.ok, true);
  assert.equal(down.board[1][2], 1);
  assert.equal(down.board[0][2], 2);

  const uneven = blank();
  for (let y = 0; y < 3; y += 1) uneven[y][2] = 3;
  for (let y = 0; y < 5; y += 1) uneven[y][3] = 4;
  const split = dropPair(uneven, { x: 2, rotation: 1, colors: [1, 2] });
  assert.equal(split.ok, true);
  assert.equal(split.board[3][2], 1, "unsupported horizontal half settles in its column");
  assert.equal(split.board[5][3], 2);

  const invalid = dropPair(board, { x: 2, rotation: 4, colors: [1, 2] });
  assert.deepEqual(invalid, { ok: false, board: original, reason: "invalid" });

  const full = blank();
  for (let y = 0; y < RULES.height; y += 1) full[y][2] = 1;
  const overflow = dropPair(full, { x: 2, rotation: 0, colors: [1, 2] });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.reason, "overflow");
  assert.deepEqual(overflow.board, full);
});

test("puyo-18 fixture is y=0 stable and resolves to eighteen four-cell chains", () => {
  assert.deepEqual(Object.keys(fixture), ["board"]);
  const board = fixture.board;
  assert.equal(board.length, RULES.height);
  assert.ok(board.every((row) => row.length === RULES.width));
  assert.equal(board.flat().filter((cell) => cell !== 0).length, 72);
  assert.deepEqual([...new Set(board.flat().filter((cell) => cell !== 0))].sort(), [1, 2, 3, 4]);
  for (let x = 0; x < RULES.width; x += 1) {
    let emptySeen = false;
    for (let y = 0; y < RULES.height; y += 1) {
      if (board[y][x] === 0) emptySeen = true;
      else assert.equal(emptySeen, false, `fixture column ${x} has a hole at row ${y}`);
    }
  }

  const result = resolve(board);
  assert.equal(result.chainCount, 18);
  assert.equal(result.steps.length, 18);
  assert.deepEqual(result.steps.map((step) => step.cleared.length), Array(18).fill(4));
  assert.deepEqual(result.steps.map((step) => step.boardAfter.flat().filter(Boolean).length),
    Array.from({ length: 18 }, (_, index) => 68 - index * 4));
  assert.ok(result.steps.every((step) => step.groups.length === 1 && step.groups[0].cells.length === 4));
  assert.ok(result.finalBoard.flat().every((cell) => cell === 0));
});
