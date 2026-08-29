import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultPromptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prompts");
const taskFiles = {
  "japanese-chat": "japanese-chat-v1.md",
  "color-cascade-18": "color-cascade-18-v1.1.md",
  "prism-twist": "prism-twist-v1.1.md",
  "lander-pop": "lander-pop-v1.1.md",
};

function textBlocks(markdown, file) {
  const blocks = [...markdown.matchAll(/```text\s*\r?\n([\s\S]*?)\r?\n```/g)].map((match) => match[1]);
  if (!blocks.length) throw new Error(`${file}: no text prompt blocks found`);
  return blocks;
}

async function blocksFrom(promptsDir, file) {
  return textBlocks(await readFile(path.join(promptsDir, file), "utf8"), file);
}

export const benchmarkTaskIds = Object.freeze(Object.keys(taskFiles));

/** Human-readable view of the exact message sequence. */
export function formatPromptText(payload) {
  return payload.sequence.flatMap((turn) => [
    `===== TURN ${turn.turn}${turn.sameConversation ? ' (same conversation)' : ''} =====`,
    ...turn.messages.flatMap((message) => [`[${message.role.toUpperCase()}]`, message.content]),
  ]).join("\n\n") + "\n";
}

/** Return the exact role/content sequence sent to a model. */
export async function buildPromptPayload(taskId, promptsDir = defaultPromptsDir) {
  const file = taskFiles[taskId];
  if (!file) throw new Error(`unknown task: ${taskId}`);
  const index = JSON.parse(await readFile(path.join(promptsDir, "index.json"), "utf8"));
  const version = index.prompts.find((prompt) => prompt.taskId === taskId)?.version;
  if (!version) throw new Error(`${taskId}: version missing from prompts/index.json`);

  if (taskId === "japanese-chat") {
    const blocks = await blocksFrom(promptsDir, file);
    if (blocks.length !== 3) throw new Error(`${file}: expected system, turn 1, and turn 2 blocks`);
    return {
      schemaVersion: 1,
      taskId,
      promptVersion: version,
      sequence: [
        { turn: 1, messages: [{ role: "system", content: blocks[0] }, { role: "user", content: blocks[1] }] },
        { turn: 2, sameConversation: true, messages: [{ role: "user", content: blocks[2] }] },
      ],
    };
  }

  const [common, task] = await Promise.all([
    blocksFrom(promptsDir, "common-coding-v1.1.md"),
    blocksFrom(promptsDir, file),
  ]);
  if (common.length !== 1 || task.length !== 1) throw new Error(`${file}: expected one common and one task block`);
  return {
    schemaVersion: 1,
    taskId,
    promptVersion: version,
    commonVersion: index.prompts.find((prompt) => prompt.taskId === "common-coding")?.version ?? null,
    sequence: [{ turn: 1, messages: [{ role: "user", content: `${common[0]}\n\n${task[0]}` }] }],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const taskId = process.argv[2];
  if (!taskId) {
    console.error(`Usage: node scripts/prompt-payload.mjs <${benchmarkTaskIds.join("|")}>`);
    process.exitCode = 2;
  } else {
    buildPromptPayload(taskId)
      .then((payload) => console.log(JSON.stringify(payload, null, 2)))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
