import assert from "node:assert/strict";
import test from "node:test";
import { benchmarkTaskIds, buildPromptPayload } from "../scripts/prompt-payload.mjs";

test("all four frozen tasks produce ready-to-send message payloads", async () => {
  assert.equal(benchmarkTaskIds.length, 4);
  for (const taskId of benchmarkTaskIds) {
    const payload = await buildPromptPayload(taskId);
    assert.equal(payload.taskId, taskId);
    assert.ok(payload.promptVersion);
    assert.ok(payload.sequence.every((turn) => turn.messages.every(({ role, content }) => (
      ["system", "user"].includes(role) && content.length > 100
    ))));
  }
  assert.equal((await buildPromptPayload("japanese-chat")).sequence.length, 2);
  assert.match((await buildPromptPayload("prism-twist")).sequence[0].messages[0].content, /隔離workspace[\s\S]*Prism Twist/);
});
