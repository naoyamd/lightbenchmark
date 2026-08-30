import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consumeCodexLine, createIsolatedCodexHome, emptyCodexStats, runCapturedProcess } from './run-codex-task.mjs';

const scriptFile = fileURLToPath(import.meta.url);

export function responseText(response) {
  if (typeof response?.output_text === 'string' && response.output_text) return response.output_text;
  return (response?.output ?? []).flatMap(item => item?.content ?? [])
    .filter(item => item?.type === 'output_text')
    .map(item => item.text ?? '')
    .join('');
}

export function addUsage(...responses) {
  const sum = getter => {
    const values = responses.map(response => getter(response?.usage ?? {}));
    return values.every(Number.isFinite) ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    inputTokens: sum(usage => usage.input_tokens),
    outputTokens: sum(usage => usage.output_tokens),
    cachedTokens: sum(usage => usage.input_tokens_details?.cached_tokens),
    reasoningTokens: sum(usage => usage.output_tokens_details?.reasoning_tokens),
    totalTokens: sum(usage => usage.total_tokens),
  };
}

function summedCodexUsage(...values) {
  values = values.filter(value => value && typeof value === 'object');
  if (!values.length) return null;
  const number = (...keys) => values.map(value => keys.map(key => value?.[key]).find(Number.isFinite));
  const sum = list => list.every(Number.isFinite) ? list.reduce((total, value) => total + value, 0) : null;
  const inputTokens = sum(number('input_tokens', 'inputTokens'));
  const outputTokens = sum(number('output_tokens', 'outputTokens'));
  return {
    inputTokens,
    outputTokens,
    cachedTokens: sum(number('cached_input_tokens', 'cachedTokens')),
    reasoningTokens: sum(number('reasoning_output_tokens', 'reasoningTokens')),
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
  };
}

export async function runChat({ workspace, model = 'gpt-5.6-luna', effort = 'max', timeoutMs = 720_000, executable = 'codex', codexHomeSource }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 720_000) {
    throw new Error('timeoutMs must be an integer from 1 to 720000');
  }
  const root = path.resolve(workspace);
  const stat = await lstat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`workspace does not exist: ${root}`);
  const outputFiles = ['turn1-response.txt', 'turn2-response.txt', 'chat-codex-events.jsonl', 'chat-codex-stderr.log', 'chat-api-run.json'];
  if ((await Promise.all(outputFiles.map(file => lstat(path.join(root, file)).catch(() => null)))).some(Boolean)) {
    throw new Error('chat output already exists; use a fresh workspace');
  }
  const [system, turn1, turn2, payloadText] = await Promise.all([
    readFile(path.join(root, 'system.txt'), 'utf8'),
    readFile(path.join(root, 'turn1.txt'), 'utf8'),
    readFile(path.join(root, 'turn2.txt'), 'utf8'),
    readFile(path.join(root, 'payload.json'), 'utf8'),
  ]);
  const payload = JSON.parse(payloadText);
  const promptHash = createHash('sha256').update(JSON.stringify(payload.sequence)).digest('hex');
  const startedAt = new Date();
  const deadline = startedAt.getTime() + timeoutMs;
  const eventFile = path.join(root, outputFiles[2]);
  const stderrFile = path.join(root, outputFiles[3]);
  const metadataFile = path.join(root, outputFiles[4]);
  const version = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true });
  const help = spawnSync(executable, ['exec', '--help'], { encoding: 'utf8', windowsHide: true }).stdout ?? '';
  const isolationFlags = ['--ignore-user-config', '--ignore-rules', '--skip-git-repo-check'].filter(flag => help.includes(flag));
  const featureList = spawnSync(executable, ['features', 'list'], { encoding: 'utf8', windowsHide: true }).stdout ?? '';
  const disabledFeatures = ['plugins', 'apps', 'skill_search', 'browser_use', 'computer_use', 'image_generation', 'workspace_dependencies', 'web_search']
    .filter(feature => new RegExp(`^${feature}\\s`, 'mu').test(featureList));
  const commonMetadata = {
    schemaVersion: 1,
    harness: 'codex-cli-chat',
    isolation: 'same-host-debug',
    officialEligible: false,
    cliVersion: version.stdout?.trim() || null,
    modelRequested: model,
    reasoningEffortRequested: effort,
    isolationFlags,
    disabledFeatures,
    sandboxRequested: 'read-only',
    networkEnforcement: 'requested-disabled; tool events independently rejected',
    codexHomeIsolation: 'auth-only-temporary-home',
    startedAt: startedAt.toISOString(),
    endedAt: null,
    durationMs: null,
    terminationReason: 'running',
    promptHash,
    budgetEnforcement: { wallClock: 'hard', agentSteps: 'observed-only', outputTokens: 'observed-only' },
  };
  await Promise.all([
    writeFile(eventFile, '', { encoding: 'utf8', flag: 'wx' }),
    writeFile(stderrFile, '', { encoding: 'utf8', flag: 'wx' }),
    writeFile(metadataFile, `${JSON.stringify(commonMetadata, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }),
  ]);
  const stats = [emptyCodexStats(), emptyCodexStats()];
  let isolatedCodexHome;
  let emptyWorkspace;
  try {
    isolatedCodexHome = await createIsolatedCodexHome(codexHomeSource);
    emptyWorkspace = await mkdtemp(path.join(tmpdir(), 'lightbenchmark-chat-'));
    const baseArgs = [
      ...isolationFlags, ...disabledFeatures.flatMap(feature => ['--disable', feature]), '--json', '--model', model,
      '-c', `model_reasoning_effort="${effort}"`, '-c', 'approval_policy="never"',
      '-c', 'sandbox_workspace_write.network_access=false', '-c', 'web_search="disabled"',
    ];
    const env = { ...process.env, CODEX_HOME: isolatedCodexHome };
    const first = await runCapturedProcess({
      executable,
      args: ['exec', ...baseArgs, '--sandbox', 'read-only', '--output-last-message', path.join(root, outputFiles[0]), '-'],
      cwd: emptyWorkspace,
      input: `<system-instructions>\n${system}\n</system-instructions>\n<user-message>\n${turn1}\n</user-message>\n外部ツールを使わず、回答本文だけを出力してください。`,
      timeoutMs: Math.max(1, deadline - Date.now()), stdoutFile: eventFile, stderrFile,
      onStdoutLine: line => consumeCodexLine(stats[0], line), env,
    });
    if (first.timedOut) throw Object.assign(new Error('chat turn 1 timed out'), { name: 'TimeoutError' });
    if (first.exitCode !== 0) throw new Error(`chat turn 1 process exited ${first.exitCode}`);
    if (stats[0].toolCalls) throw new Error('chat turn 1 attempted to use tools');
    const firstText = await readFile(path.join(root, outputFiles[0]), 'utf8');
    if (!firstText.trim()) throw new Error('turn 1 returned no output text');
    await writeFile(metadataFile, `${JSON.stringify({
      ...commonMetadata,
      terminationReason: 'running-turn-2',
      threadId: stats[0].threadId,
      usage: summedCodexUsage(stats[0].usage),
    }, null, 2)}\n`, 'utf8');
    if (!stats[0].threadId) throw new Error('chat turn 1 did not report a resumable thread id');
    const second = await runCapturedProcess({
      executable,
      args: ['exec', 'resume', ...baseArgs, '--output-last-message', path.join(root, outputFiles[1]), stats[0].threadId, '-'],
      cwd: emptyWorkspace,
      input: turn2,
      timeoutMs: Math.max(1, deadline - Date.now()), stdoutFile: eventFile, stderrFile,
      onStdoutLine: line => consumeCodexLine(stats[1], line), env,
    });
    if (second.timedOut) throw Object.assign(new Error('chat turn 2 timed out'), { name: 'TimeoutError' });
    if (second.exitCode !== 0) throw new Error(`chat turn 2 process exited ${second.exitCode}`);
    if (stats[1].toolCalls) throw new Error('chat turn 2 attempted to use tools');
    const secondText = await readFile(path.join(root, outputFiles[1]), 'utf8');
    if (!secondText.trim()) throw new Error('turn 2 returned no output text');
    const endedAt = new Date();
    const metadata = {
      ...commonMetadata,
      endedAt: endedAt.toISOString(),
      durationMs: endedAt - startedAt,
      terminationReason: 'completed',
      threadId: stats[0].threadId,
      itemCount: stats[0].itemCount + stats[1].itemCount,
      toolCalls: stats[0].toolCalls + stats[1].toolCalls,
      subagents: stats[0].subagents + stats[1].subagents,
      malformedLines: stats[0].malformedLines + stats[1].malformedLines,
      usage: summedCodexUsage(stats[0].usage, stats[1].usage),
    };
    await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    return metadata;
  } catch (error) {
    const endedAt = new Date();
    const metadata = {
      ...commonMetadata,
      endedAt: endedAt.toISOString(),
      durationMs: endedAt - startedAt,
      terminationReason: error?.name === 'TimeoutError' ? 'timeout' : 'harness-error',
      threadId: stats[0].threadId,
      itemCount: stats[0].itemCount + stats[1].itemCount,
      toolCalls: stats[0].toolCalls + stats[1].toolCalls,
      subagents: stats[0].subagents + stats[1].subagents,
      malformedLines: stats[0].malformedLines + stats[1].malformedLines,
      usage: summedCodexUsage(stats[0].usage, stats[1].usage),
      error: error instanceof Error ? error.message : String(error),
    };
    await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    if (emptyWorkspace) await rm(emptyWorkspace, { recursive: true, force: true });
    if (isolatedCodexHome) await rm(isolatedCodexHome, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  const workspace = args.shift();
  if (!workspace) throw new Error('Usage: node scripts/run-chat-openai.mjs <workspace> [--model ID] [--effort LEVEL] [--timeout-ms N]');
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
  runChat(parseArgs(process.argv.slice(2)))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
