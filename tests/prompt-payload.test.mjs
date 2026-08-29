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
    version: "PUYO-1.3",
    file: "color-cascade-18-v1.3.md",
    sha256: "b2d15fec460842455ad7701f0f71bd76ad04601a7839eb31073df55cea5008a1",
    previousSha256: "f58978d575ee6138415240762b9626e5e21f52b9ae0b94ae4f66a4d8a2f256cd",
  },
  "prism-twist": {
    version: "CUBE-1.2",
    file: "prism-twist-v1.2.md",
    sha256: "ee91a37c6bd6ea988cfaa8fb355b10b9a428b4746e2b0b63536a3013ce95fa47",
    previousSha256: "5d921ddfeba34dd68da0bc022e4a5092c6e55c79d82ec5557bb80322250b1e31",
  },
  "lander-pop": {
    version: "LANDER-1.1",
    file: "lander-pop-v1.1.md",
    sha256: "2d109525e2cff601e97358927fcb16a55942f3895244f4916e22c65bfab17bd0",
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
  assert.match((await buildPromptPayload("color-cascade-18")).sequence[0].messages[0].content, /完成盤面の探索は今回の評価対象ではありません[\s\S]*\[\[2,1,1,2,1,1\]/);
  assert.match((await buildPromptPayload("prism-twist")).sequence[0].messages[0].content, /隔離workspace[\s\S]*3×3 ルービックキューブ/);
});

test("coding public-v1 payloads use the frozen filenames and changed hashes", async () => {
  const index = JSON.parse(await readFile(path.join(promptsDir, "index.json"), "utf8"));
  const commonEntry = index.prompts.find((prompt) => prompt.taskId === "common-coding");
  assert.deepEqual(commonEntry && { version: commonEntry.version, file: commonEntry.file }, {
    version: "CODE-1.2",
    file: "common-coding-v1.2.md",
  });
  for (const [taskId, expected] of Object.entries(publicV1)) {
    const entry = index.prompts.find((prompt) => prompt.taskId === taskId);
    assert.deepEqual(entry && { version: entry.version, file: entry.file }, {
      version: expected.version,
      file: expected.file,
    });
    const payload = await buildPromptPayload(taskId, promptsDir);
    assert.equal(payload.promptVersion, expected.version);
    assert.equal(payload.commonVersion, "CODE-1.2");
    assert.equal(sequenceHash(payload), expected.sha256);
    assert.notEqual(sequenceHash(payload), expected.previousSha256);
  }
  assert.equal(sequenceHash(await buildPromptPayload("japanese-chat", promptsDir)), "47e11d62fbba12e1fb1948b0655d449e5003521f4530308033f86a91e705e73a");
});
