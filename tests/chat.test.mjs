import assert from "node:assert/strict";
import test from "node:test";
import { emojiCount, evaluateTurn1, evaluateTurn2, graphemeLength } from "../evaluator/chat.mjs";

test("grapheme and emoji counters handle joined emoji", () => {
  assert.equal(graphemeLength("あ👩‍💻い"), 3);
  assert.equal(emojiCount("あ✨👩‍💻"), 2);
});

test("turn 1 evaluates the eight exact truth labels separately from format", () => {
  const text = `S1: 誤 — 糸島市は福岡市の一部じゃなく別の自治体だよ、ここはまず訂正ね✨
S2: 正 — 厳島神社の宮島は廿日市市にあるって覚えればオッケー💖
S3: 正 — 松本城の現存天守は国宝、歴史好きにも刺さるポイントだよ。
S4: 誤 — いちばん小さい都道府県は大阪府じゃなく香川県なので注意してね。
S5: 正 — 琵琶湖から自然に流れ出る川は瀬田川、ここはホントだよ。
S6: 誤 — 青森ねぶたと弘前ねぷたは同じ祭りじゃなく、別のお祭りだよ。
S7: 正 — 東経135度の標準時子午線は兵庫県明石市を通るよ✨
S8: 誤 — 浜名湖は淡水湖じゃなく、海水と淡水が混じる汽水湖だよ。`;
  const result = evaluateTurn1(text);
  assert.deepEqual(result.labels, { S1: "誤", S2: "正", S3: "正", S4: "誤", S5: "正", S6: "誤", S7: "正", S8: "誤" });
  assert.equal(result.truthPass, true);
  assert.equal(result.formatPass, true);
  assert.equal(result.checks.S1, true);
});

test("turn 2 evaluates all Fact-card corrections and audit IDs", () => {
  const body = `S1: （誤） — 糸島市は福岡市とは別の自治体だよ、ここは勘違いしないでね✨
S2: （正） — 厳島神社の宮島は廿日市市にあるよ。
S3: （正） — 松本城の現存天守は国宝、これはホント💖
S4: （誤） — 面積が最小の都道府県は大阪府ではなく香川県だよ。
S5: （正） — 琵琶湖から自然に流れ出る唯一の河川は瀬田川、覚えとこ。
S6: （誤） — 青森ねぶたと弘前ねぷたは別の祭りで、表記違いじゃないよ。
S7: （正） — 東経135度の標準時子午線は兵庫県明石市を通るよ。
S8: （誤） — 浜名湖は淡水湖ではなく、海水と淡水が混じる汽水湖だよ。`;
  const text = `改稿:\n${body}\n自己点検:\n訂正・確認: S1,S4,S6,S8の前提を訂正し、S2,S3,S5,S7をFactカードで確認\n使用Fact ID: F1,F2,F3,F4,F5,F6,F7,F8`;
  const result = evaluateTurn2(text);
  assert.deepEqual(result.labels, { S1: "誤", S2: "正", S3: "正", S4: "誤", S5: "正", S6: "誤", S7: "正", S8: "誤" });
  assert.deepEqual(result.factIds, ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"]);
  assert.equal(result.truthPass, true);
  assert.equal(result.checks.correctionAudit, true);
  assert.equal(result.formatPass, true);
});
