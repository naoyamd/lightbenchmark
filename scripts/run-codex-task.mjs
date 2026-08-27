import { spawn, spawnSync } from 'node:child_process';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);

export function emptyCodexStats() {
  return { threadId: null, itemCount: 0, toolCalls: 0, subagents: 0, usage: null, malformedLines: 0 };
}

export function consumeCodexLine(stats, line) {
  if (!line.trim()) return;
  let event;
  try { event = JSON.parse(line); } catch { stats.malformedLines += 1; return; }
  if (event.type === 'thread.started') stats.threadId = event.thread_id ?? null;
  if (event.type === 'turn.completed') stats.usage = event.usage ?? null;
  if (event.type !== 'item.completed') return;
  stats.itemCount += 1;
  const type = event.item?.type;
  if (type && type !== 'agent_message' && type !== 'reasoning') stats.toolCalls += 1;
  if (type === 'collaboration_tool_call' && /spawn_agent/u.test(JSON.stringify(event.item))) stats.subagents += 1;
}

// ponytail: in-memory capture is enough for the 20k-token cap; stream-parse if that cap grows materially.
export function runCapturedProcess({ executable, args, cwd, input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date();
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      const endedAt = new Date();
      resolve({ startedAt, endedAt, durationMs: endedAt - startedAt, exitCode, signal, timedOut, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

export async function runCodexTask({ workspace, model = 'gpt-5.6-luna', effort = 'max', timeoutMs = 720_000, executable = 'codex' }) {
  const root = path.resolve(workspace);
  const stat = await lstat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`workspace does not exist: ${root}`);
  if (await lstat(path.join(root, 'system.txt')).catch(() => null)) {
    throw new Error('japanese-chat must use run-chat-openai.mjs, not the Codex agent harness');
  }
  const outputFiles = ['codex-events.jsonl', 'codex-stderr.log', 'final.txt', 'codex-run.json'];
  if ((await Promise.all(outputFiles.map(file => lstat(path.join(root, file)).catch(() => null)))).some(Boolean)) {
    throw new Error('Codex output already exists; use a fresh workspace');
  }
  const site = path.join(root, 'submission', 'site');
  if ((await readdir(site)).length) throw new Error('submission/site must be empty before a run');
  const prompt = await readFile(path.join(root, 'prompt.txt'), 'utf8');
  const finalFile = path.join(root, 'final.txt');
  const args = [
    'exec', '--json', '--model', model,
    '-c', `model_reasoning_effort="${effort}"`,
    '--sandbox', 'workspace-write',
    '--output-last-message', finalFile,
    '-',
  ];
  const version = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true });
  const result = await runCapturedProcess({ executable, args, cwd: root, input: prompt, timeoutMs });
  const stats = emptyCodexStats();
  for (const line of result.stdout.split(/\r?\n/u)) consumeCodexLine(stats, line);
  const metadata = {
    schemaVersion: 1,
    harness: 'codex-cli-agent',
    isolation: 'same-host-debug',
    officialEligible: false,
    cliVersion: version.stdout?.trim() || null,
    modelRequested: model,
    reasoningEffortRequested: effort,
    sandboxRequested: 'workspace-write',
    networkForModelTools: false,
    startedAt: result.startedAt.toISOString(),
    endedAt: result.endedAt.toISOString(),
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    terminationReason: result.timedOut ? 'timeout' : result.exitCode === 0 ? 'completed' : 'process-error',
    ...stats,
  };
  await Promise.all([
    writeFile(path.join(root, outputFiles[0]), result.stdout, 'utf8'),
    writeFile(path.join(root, outputFiles[1]), result.stderr, 'utf8'),
    writeFile(path.join(root, outputFiles[3]), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8'),
  ]);
  return metadata;
}

function parseArgs(args) {
  const workspace = args.shift();
  if (!workspace) throw new Error('Usage: node scripts/run-codex-task.mjs <workspace> [--model ID] [--effort LEVEL] [--timeout-ms N]');
  const options = { workspace };
  while (args.length) {
    const key = args.shift();
    const value = args.shift();
    if (!value) throw new Error(`${key} requires a value`);
    if (key === '--model') options.model = value;
    else if (key === '--effort') options.effort = value;
    else if (key === '--timeout-ms') options.timeoutMs = Number(value);
    else throw new Error(`unknown option: ${key}`);
  }
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error('--timeout-ms must be a positive integer');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  runCodexTask(parseArgs(process.argv.slice(2)))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
