import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkTaskIds, buildPromptPayload } from './prompt-payload.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workRoot = path.join(projectRoot, 'work');
const defaultId = `benchmark-run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const target = path.resolve(process.argv[2] ?? path.join(workRoot, defaultId));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

const relative = path.relative(workRoot, target);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error(`run workspace must be a new child of ${workRoot}`);
}
if (await lstat(target).catch(() => null)) {
  throw new Error(`run workspace already exists: ${target}`);
}

await mkdir(target, { recursive: true });
const commitments = { schemaVersion: 1, createdAt: new Date().toISOString(), prompts: {} };

for (const taskId of benchmarkTaskIds) {
  const payload = await buildPromptPayload(taskId);
  const taskRoot = path.join(target, taskId);
  await mkdir(path.join(taskRoot, 'submission', 'site'), { recursive: true });
  await writeFile(path.join(taskRoot, 'payload.json'), `${JSON.stringify(payload, null, 2)}\n`);
  commitments.prompts[taskId] = hash(JSON.stringify(payload.sequence));
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
  }
}

await writeFile(path.join(target, 'commitment.json'), `${JSON.stringify(commitments, null, 2)}\n`);
console.log(JSON.stringify({ target, commitments }, null, 2));
