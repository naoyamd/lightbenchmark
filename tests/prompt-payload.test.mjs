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
    version: "PUYO-1.5",
    file: "color-cascade-18-v1.5.md",
    sha256: "f71693c67c15fe896cd876d00ad4fe9d9f43869c7a9139832fe9f98ff3ccf400",
    previousSha256: "a26b56a56c25b0c294d1cd3cea67145d6730469224c873470c041aa18c224af7",
  },
  "prism-twist": {
    version: "CUBE-1.4",
    file: "prism-twist-v1.4.md",
    sha256: "51af3686d4130d75f20aba49748d8d206cf7bd6a276c17435ff020e82fd6b3e5",
    previousSha256: "0dc0b4f2482d8b215e88ecde02922a068bd64079e14a7cc22a4e26a86f28d854",
  },
  "lander-pop": {
    version: "LANDER-2.1",
    file: "lander-pop-v2.1.md",
    sha256: "98b854ebcfcaa008436a0c50697ca48b6d54820f30ced5d4315d88ad86dfa3c1",
    previousSha256: "511d058755433024d4ca162c9ce21aa41a2d586a180c59b8228cbcd55d54b3aa",
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
  assert.match((await buildPromptPayload("color-cascade-18")).sequence[0].messages[0].content, /非zero cellは正確に70個[\s\S]*\[\[4,4,4,2,2,3\]/);
  assert.match((await buildPromptPayload("prism-twist")).sequence[0].messages[0].content, /隔離workspace[\s\S]*3×3 ルービックキューブ/);
});

test("coding public-v1 payloads use the frozen filenames and changed hashes", async () => {
  const index = JSON.parse(await readFile(path.join(promptsDir, "index.json"), "utf8"));
  const commonEntry = index.prompts.find((prompt) => prompt.taskId === "common-coding");
  assert.deepEqual(commonEntry && { version: commonEntry.version, file: commonEntry.file }, {
    version: "CODE-1.4",
    file: "common-coding-v1.4.md",
  });
  for (const [taskId, expected] of Object.entries(publicV1)) {
    const entry = index.prompts.find((prompt) => prompt.taskId === taskId);
    assert.deepEqual(entry && { version: entry.version, file: entry.file }, {
      version: expected.version,
      file: expected.file,
    });
    const payload = await buildPromptPayload(taskId, promptsDir);
    assert.equal(payload.promptVersion, expected.version);
    assert.equal(payload.commonVersion, "CODE-1.4");
    assert.equal(sequenceHash(payload), expected.sha256);
    assert.notEqual(sequenceHash(payload), expected.previousSha256);
  }
  assert.equal(sequenceHash(await buildPromptPayload("japanese-chat", promptsDir)), "4f9cb1e871360fddbfd22f521b6021a643d4feeb0fe75c56f61eedff9e7fb290");
});
