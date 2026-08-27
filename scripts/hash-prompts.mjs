import { createHash } from "node:crypto";
import { benchmarkTaskIds, buildPromptPayload } from "./prompt-payload.mjs";

const prompts = await Promise.all(benchmarkTaskIds.map(async (taskId) => {
  const payload = await buildPromptPayload(taskId);
  return {
    taskId,
    version: payload.promptVersion,
    sha256: createHash("sha256").update(JSON.stringify(payload.sequence)).digest("hex"),
  };
}));

console.log(JSON.stringify({ schemaVersion: 1, prompts }, null, 2));
