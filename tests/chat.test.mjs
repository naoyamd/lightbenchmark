import assert from "node:assert/strict";
import test from "node:test";
import { emojiCount, evaluateTurn1, evaluateTurn2, graphemeLength } from "../evaluator/chat.mjs";

test("grapheme and emoji counters handle joined emoji", () => {
  assert.equal(graphemeLength("あ👩‍💻い"), 3);
  assert.equal(emojiCount("あ✨👩‍💻"), 2);
});
test("turn 1 exposes individual deterministic checks", () => {
  const text = `${"糸島市は福岡市とは別の市で、西側に隣接してるよ。海と山の自然、魚や野菜などの食、滝の散策も楽しめてマジで多彩✨💖".repeat(3)}移動は目的地ごとの時刻を確認して計画するのが注意。`;
  const result = evaluateTurn1(text);
  assert.equal(typeof result.formatPass, "boolean");
  assert.equal(result.checks.separateCity, true);
  assert.equal(result.emojis, 6);
});

test("turn 2 parses fact IDs and audit fields", () => {
  const body = `${"糸島は福岡市の中ではなく、西側に隣接する別の市。海と山、農畜産物や海産物、滝や遺跡まで楽しめるよ✨ 公共交通は中心部へ便利でも、目的地ごとの移動は時刻を確認してね。".repeat(2)}`;
  const text = `改稿:\n${body}\n自己点検:\n訂正・弱めた点: 行政区分と交通の断定を訂正\n使用Fact ID: F1,F2,F3,F4`;
  const result = evaluateTurn2(text);
  assert.deepEqual(result.factIds, ["F1", "F2", "F3", "F4"]);
  assert.equal(result.checks.structure, true);
  assert.equal(result.checks.correctionAudit, true);
});
