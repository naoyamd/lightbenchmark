import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);

export async function createCandidateWorkspace(source) {
  const target = await mkdtemp(path.join(tmpdir(), 'lightbenchmark-candidate-'));
  try {
    await mkdir(path.join(target, 'submission', 'site'), { recursive: true });
    await Promise.all(['prompt.txt', 'public-tests.mjs', 'showcase-smoke.mjs'].map(file => cp(path.join(source, file), path.join(target, file))));
    return target;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

export async function createIsolatedCodexHome(source = process.env.CODEX_HOME || path.join(homedir(), '.codex')) {
  const target = await mkdtemp(path.join(tmpdir(), 'lightbenchmark-codex-home-'));
  try {
    await cp(path.join(source, 'auth.json'), path.join(target, 'auth.json'), { errorOnExist: true, force: false });
    return target;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

async function collectCandidateWorkspace(source, target) {
  const sourceSite = path.join(source, 'submission', 'site');
  const targetSite = path.join(target, 'submission', 'site');
  for (const entry of await readdir(sourceSite)) {
    await cp(path.join(sourceSite, entry), path.join(targetSite, entry), { recursive: true, errorOnExist: true, force: false });
  }
  const final = path.join(source, 'final.txt');
  if (await lstat(final).catch(() => null)) await cp(final, path.join(target, 'final.txt'), { errorOnExist: true, force: false });
}

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
  if ((type === 'collab_tool_call' || type === 'collaboration_tool_call')
    && /spawn_agent/u.test(JSON.stringify(event.item))) stats.subagents += 1;
}

function terminateProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const fallback = setTimeout(() => {
      child.kill();
      killer.kill();
    }, 5_000);
    killer.once('error', () => child.kill());
    killer.once('close', () => clearTimeout(fallback));
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

export function runCapturedProcess({ executable, args, cwd, input, timeoutMs, stdoutFile, stderrFile, onStdoutLine, startedAt = new Date(), env = process.env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdoutSink = stdoutFile ? createWriteStream(stdoutFile, { flags: 'a' }) : null;
    const stderrSink = stderrFile ? createWriteStream(stderrFile, { flags: 'a' }) : null;
    let stdout = stdoutFile ? null : '';
    let stderr = '';
    let lineBuffer = '';
    let timedOut = false;
    let settled = false;
    let forcedClose;
    const deadline = new Date(startedAt.getTime() + timeoutMs);
    const settle = async (exitCode, signal, endedAt = new Date()) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forcedClose);
      if (lineBuffer) onStdoutLine?.(lineBuffer);
      child.stdout.destroy();
      child.stderr.destroy();
      stdoutSink?.end();
      stderrSink?.end();
      const sinkError = await Promise.all([stdoutSink && finished(stdoutSink), stderrSink && finished(stderrSink)].filter(Boolean)).then(() => null, error => error);
      if (sinkError) reject(sinkError);
      else resolve({ startedAt, endedAt, durationMs: endedAt - startedAt, exitCode, signal, timedOut, stdout, stderr });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
      // A detached grandchild can inherit stdout and keep Node's `close` event pending forever.
      forcedClose = setTimeout(() => settle(null, 'deadline', deadline), 1_000);
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      clearTimeout(forcedClose);
      settled = true;
      stdoutSink?.destroy();
      stderrSink?.destroy();
      reject(error);
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (stdout === null) stdoutSink.write(chunk);
      else stdout += chunk;
      if (!onStdoutLine) return;
      lineBuffer += chunk;
      const lines = lineBuffer.split(/\r?\n/u);
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) onStdoutLine(line);
    });
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-65_536);
      stderrSink?.write(chunk);
    });
    child.once('close', (exitCode, signal) => settle(exitCode, signal, timedOut ? deadline : new Date()));
    child.stdin.end(input);
  });
}

export async function runCodexTask({ workspace, model = 'gpt-5.6-luna', effort = 'max', timeoutMs = 720_000, executable = 'codex' }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 720_000) {
    throw new Error('timeoutMs must be an integer from 1 to 720000');
  }
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
  const eventFile = path.join(root, outputFiles[0]);
  const stderrFile = path.join(root, outputFiles[1]);
  const metadataFile = path.join(root, outputFiles[3]);
  const startedAt = new Date();
  const stats = emptyCodexStats();
  const version = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true });
  const help = spawnSync(executable, ['exec', '--help'], { encoding: 'utf8', windowsHide: true }).stdout ?? '';
  const isolationFlags = ['--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check'].filter(flag => help.includes(flag));
  const featureList = spawnSync(executable, ['features', 'list'], { encoding: 'utf8', windowsHide: true }).stdout ?? '';
  const disabledFeatures = ['plugins', 'apps', 'skill_search', 'browser_use', 'computer_use', 'image_generation', 'workspace_dependencies']
    .filter(feature => new RegExp(`^${feature}\\s`, 'mu').test(featureList));
  const runningMetadata = {
    schemaVersion: 1,
    harness: 'codex-cli-agent',
    isolation: 'same-host-debug',
    officialEligible: false,
    cliVersion: version.stdout?.trim() || null,
    modelRequested: model,
    reasoningEffortRequested: effort,
    sandboxRequested: 'workspace-write',
    isolationFlags,
    disabledFeatures,
    execPolicy: 'controlled rules ignored; on-request with auto-review',
    networkEnforcement: 'requested-disabled; not independently verified',
    candidateWorkspaceIsolation: 'repo-external-temporary-copy',
    codexHomeIsolation: 'auth-only-temporary-home',
    startedAt: startedAt.toISOString(),
    endedAt: null,
    durationMs: null,
    terminationReason: 'running',
    budgetEnforcement: { wallClock: 'hard', agentSteps: 'observed-only', outputTokens: 'observed-only' },
  };
  await Promise.all([
    writeFile(eventFile, '', { encoding: 'utf8', flag: 'wx' }),
    writeFile(stderrFile, '', { encoding: 'utf8', flag: 'wx' }),
    writeFile(metadataFile, `${JSON.stringify(runningMetadata, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }),
  ]);
  let result;
  let processError;
  let candidateRoot;
  let isolatedCodexHome;
  try {
    candidateRoot = await createCandidateWorkspace(root);
    isolatedCodexHome = await createIsolatedCodexHome();
    const args = [
      'exec', ...isolationFlags, ...disabledFeatures.flatMap(feature => ['--disable', feature]), '--json', '--model', model,
      '-c', `model_reasoning_effort="${effort}"`,
      '-c', 'approval_policy="on-request"',
      '-c', 'approvals_reviewer="auto_review"',
      '-c', 'sandbox_workspace_write.network_access=false',
      '-c', 'shell_environment_policy.ignore_default_excludes=false',
      '--sandbox', 'workspace-write',
      '--output-last-message', path.join(candidateRoot, 'final.txt'),
      '-',
    ];
    result = await runCapturedProcess({
      executable, args, cwd: candidateRoot, input: prompt, timeoutMs, stdoutFile: eventFile, stderrFile,
      onStdoutLine: line => consumeCodexLine(stats, line), startedAt,
      env: { ...process.env, CODEX_HOME: isolatedCodexHome, LIGHTBENCH_CANDIDATE_RUN: '1' },
    });
  } catch (error) {
    processError = error;
  }
  try {
    if (candidateRoot) await collectCandidateWorkspace(candidateRoot, root);
  } catch (error) {
    processError ??= error;
  } finally {
    if (candidateRoot) await rm(candidateRoot, { recursive: true, force: true });
    if (isolatedCodexHome) await rm(isolatedCodexHome, { recursive: true, force: true });
  }
  if (processError) {
    const endedAt = new Date();
    const failedMetadata = {
      ...runningMetadata,
      endedAt: endedAt.toISOString(),
      durationMs: endedAt - startedAt,
      terminationReason: 'process-spawn-error',
      error: processError instanceof Error ? processError.message : String(processError),
      ...stats,
    };
    await writeFile(metadataFile, `${JSON.stringify(failedMetadata, null, 2)}\n`, 'utf8');
    throw processError;
  }
  const metadata = {
    ...runningMetadata,
    endedAt: result.endedAt.toISOString(),
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    terminationReason: result.timedOut ? 'timeout' : result.exitCode === 0 ? 'completed' : 'process-error',
    ...stats,
  };
  await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
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
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 720_000)) {
    throw new Error('--timeout-ms must be an integer from 1 to 720000');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  runCodexTask(parseArgs(process.argv.slice(2)))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
