import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { benchmarkTaskIds, buildPromptPayload } from "../scripts/prompt-payload.mjs";

const promptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prompts");
const publicV1 = {
  "color-cascade-18": {
    version: "PUYO-1.1",
    file: "color-cascade-18-v1.1.md",
    sha256: "6e9db167eddc91124b1beaeb363eb433d9ded863c9dd1e7c8b6bd12ac6c6f906",
    previousSha256: "c14fc0dac0acfb124fd8fd7726f30a317f23c2a7ab61a022d15f200201d23f5d",
  },
  "prism-twist": {
    version: "CUBE-1.1",
    file: "prism-twist-v1.1.md",
    sha256: "5d921ddfeba34dd68da0bc022e4a5092c6e55c79d82ec5557bb80322250b1e31",
    previousSha256: "92b3fe4e70a0618e8b452c075ae2d49db4a1438667292ee98fbe5a8eabd7f9ac",
  },
  "lander-pop": {
    version: "LANDER-1.1",
    file: "lander-pop-v1.1.md",
    sha256: "672fd156970b7932f2f774086d0a6a2f0aa933e10589665109e3fc317354d6b0",
    previousSha256: "63b1fffad49bccfb904d3cedb08005dd643e8a9b32fdf8a337f3ac3f5aa62d0d",
  },
};

function sequenceHash(payload) {
  return createHash("sha256").update(JSON.stringify(payload.sequence)).digest("hex");
}

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

test("coding public-v1 payloads use v1.1 filenames and changed hashes", async () => {
  const index = JSON.parse(await readFile(path.join(promptsDir, "index.json"), "utf8"));
  const commonEntry = index.prompts.find((prompt) => prompt.taskId === "common-coding");
  assert.deepEqual(commonEntry && { version: commonEntry.version, file: commonEntry.file }, {
    version: "CODE-1.1",
    file: "common-coding-v1.1.md",
  });
  for (const [taskId, expected] of Object.entries(publicV1)) {
    const entry = index.prompts.find((prompt) => prompt.taskId === taskId);
    assert.deepEqual(entry && { version: entry.version, file: entry.file }, {
      version: expected.version,
      file: expected.file,
    });
    const payload = await buildPromptPayload(taskId, promptsDir);
    assert.equal(payload.promptVersion, expected.version);
    assert.equal(payload.commonVersion, "CODE-1.1");
    assert.equal(sequenceHash(payload), expected.sha256);
    assert.notEqual(sequenceHash(payload), expected.previousSha256);
  }
  assert.equal(sequenceHash(await buildPromptPayload("japanese-chat", promptsDir)), "47e11d62fbba12e1fb1948b0655d449e5003521f4530308033f86a91e705e73a");
});
