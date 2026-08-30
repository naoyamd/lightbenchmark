import { createHash, randomBytes } from 'node:crypto';
import { cp, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScenario as createArmScenario } from '../evaluator/arm.mjs';
import { benchmarkTaskIds, buildPromptPayload } from './prompt-payload.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workRoot = path.join(projectRoot, 'work');
const defaultId = `benchmark-run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const target = path.resolve(process.argv[2] ?? path.join(workRoot, defaultId));
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const uint32 = () => randomBytes(4).readUInt32LE();

async function evaluatorHash(taskId) {
  const files = taskId === 'japanese-chat'
    ? ['evaluator/chat.mjs']
    : ['scripts/evaluate-submission.mjs', 'scripts/showcase-smoke.mjs', `evaluator/${({ 'color-cascade-18': 'puyo', 'prism-twist': 'cube', 'robot-arm-sort': 'arm' })[taskId]}.mjs`];
  return hash((await Promise.all(files.map(file => readFile(path.join(projectRoot, file))))).map((bytes, index) => `${files[index]}\0${hash(bytes)}`).join('\n'));
}

function randomBoard() {
  const bytes = randomBytes(42);
  const heights = [...randomBytes(6)].map(value => value % 7);
  return Array.from({ length: 14 }, (_, y) => Array.from({ length: 6 }, (_, x) => y < heights[x] ? 1 + bytes[(x * 7 + y) % bytes.length] % 4 : 0));
}

function fixtures() {
  const scenarios = Array.from({ length: 4 }, (_, index) => ({ id: `scenario-${index + 1}`, ...createArmScenario(uint32()) }));
  const boards = Array.from({ length: 6 }, randomBoard);
  return {
    'japanese-chat': { facts: { S1: false, S2: true, S3: true, S4: false, S5: true, S6: false, S7: true, S8: false } },
    'color-cascade-18': {
      planCases: Array.from({ length: 6 }, () => ({ goalSeed: uint32(), planSeed: uint32() })),
      boards,
      pairs: boards.map((board, index) => ({ board, pair: { x: index % 5, rotation: index % 2, colors: [1 + index % 4, 1 + (index + 1) % 4] } })),
    },
    'prism-twist': {
      seeds: [{ seed: uint32(), length: 25 }, { seed: uint32(), length: 31 }, { seed: uint32(), length: 25 }],
      algorithms: [["R", "U", "R'", "U'"], ["F2", "D", "L'", "B", "U2", "R"]],
    },
    'robot-arm-sort': { scenarios },
  };
}

const relative = path.relative(workRoot, target);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error(`run workspace must be a new child of ${workRoot}`);
}
if (await lstat(target).catch(() => null)) {
  throw new Error(`run workspace already exists: ${target}`);
}

await mkdir(target, { recursive: true });
await mkdir(path.join(target, '.fixtures'));
const sealedFixtures = fixtures();
const commitments = { schemaVersion: 3, createdAt: new Date().toISOString(), prompts: {}, evaluators: {}, fixtures: {} };

for (const taskId of benchmarkTaskIds) {
  const payload = await buildPromptPayload(taskId);
  const taskRoot = path.join(target, taskId);
  await mkdir(path.join(taskRoot, 'submission', 'site'), { recursive: true });
  await writeFile(path.join(taskRoot, 'payload.json'), `${JSON.stringify(payload, null, 2)}\n`);
  commitments.prompts[taskId] = hash(JSON.stringify(payload.sequence));
  commitments.evaluators[taskId] = await evaluatorHash(taskId);
  commitments.fixtures[taskId] = hash(sealedFixtures[taskId]);
  await writeFile(path.join(target, '.fixtures', `${taskId}.json`), `${JSON.stringify({ taskId, fixture: sealedFixtures[taskId] }, null, 2)}\n`);
  if (taskId === 'japanese-chat') {
    await writeFile(path.join(taskRoot, 'system.txt'), payload.sequence[0].messages[0].content);
    await writeFile(path.join(taskRoot, 'turn1.txt'), payload.sequence[0].messages[1].content);
    await writeFile(path.join(taskRoot, 'turn2.txt'), payload.sequence[1].messages[0].content);
  } else {
    await writeFile(path.join(taskRoot, 'prompt.txt'), payload.sequence[0].messages[0].content);
    await cp(
      path.join(projectRoot, 'starters', taskId, 'public-tests.mjs'),
      path.join(taskRoot, 'public-tests.mjs'),
    );
    await cp(path.join(projectRoot, 'scripts', 'showcase-smoke.mjs'), path.join(taskRoot, 'showcase-smoke.mjs'));
  }
}

await writeFile(path.join(target, 'commitment.json'), `${JSON.stringify(commitments, null, 2)}\n`);
console.log(JSON.stringify({ target, commitments }, null, 2));
