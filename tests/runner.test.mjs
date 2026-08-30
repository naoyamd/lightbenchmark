import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { finalizeDebugRun } from '../scripts/finalize-debug-run.mjs';
import { buildPromptPayload } from '../scripts/prompt-payload.mjs';
import { addUsage, responseText, runChat } from '../scripts/run-chat-openai.mjs';
import { consumeCodexLine, createCandidateWorkspace, createIsolatedCodexHome, emptyCodexStats, runCapturedProcess } from '../scripts/run-codex-task.mjs';

test('raw chat helpers preserve text and sum reported usage', () => {
  const first = { output: [{ content: [{ type: 'output_text', text: 'one' }] }], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 3 } } };
  const second = { output_text: 'two', usage: { input_tokens: 20, output_tokens: 6, total_tokens: 26, input_tokens_details: { cached_tokens: 5 }, output_tokens_details: { reasoning_tokens: 4 } } };
  assert.equal(responseText(first), 'one');
  assert.equal(responseText(second), 'two');
  assert.deepEqual(addUsage(first, second), { inputTokens: 30, outputTokens: 10, cachedTokens: 7, reasoningTokens: 7, totalTokens: 40 });
  assert.deepEqual(addUsage({ usage: { input_tokens: 1 } }), { inputTokens: 1, outputTokens: null, cachedTokens: null, reasoningTokens: null, totalTokens: null });
});

test('chat runner uses isolated Codex auth instead of an API key', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lightbenchmark-chat-'));
  const auth = await mkdtemp(path.join(tmpdir(), 'lightbenchmark-chat-auth-'));
  const previousKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    await Promise.all([
      writeFile(path.join(root, 'system.txt'), 'system'),
      writeFile(path.join(root, 'turn1.txt'), 'turn one'),
      writeFile(path.join(root, 'turn2.txt'), 'turn two'),
      writeFile(path.join(root, 'payload.json'), JSON.stringify({ sequence: [] })),
      writeFile(path.join(auth, 'auth.json'), '{}'),
    ]);
    await assert.rejects(() => runChat({ workspace: root, executable: 'lightbenchmark-missing-codex', codexHomeSource: auth }), /ENOENT|EPERM|not found/u);
    const metadata = JSON.parse(await readFile(path.join(root, 'chat-api-run.json'), 'utf8'));
    assert.equal(metadata.officialEligible, false);
    assert.equal(metadata.harness, 'codex-cli-chat');
    assert.equal(metadata.terminationReason, 'harness-error');
    assert.equal(metadata.usage, null);
    assert.doesNotMatch(metadata.error, /OPENAI_API_KEY/u);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
    await rm(auth, { recursive: true, force: true });
  }
});

test('runners reject timeouts beyond the hard benchmark limit', async () => {
  await assert.rejects(() => runChat({ workspace: '.', timeoutMs: 720_001 }), /1 to 720000/u);
});

test('Codex JSONL parser records usage, tools, and subagents', () => {
  const stats = emptyCodexStats();
  for (const event of [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'item.completed', item: { type: 'command_execution' } },
    { type: 'item.completed', item: { type: 'collab_tool_call', tool: 'spawn_agent' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
  ]) consumeCodexLine(stats, JSON.stringify(event));
  assert.deepEqual(stats, { threadId: 'thread-1', itemCount: 2, toolCalls: 2, subagents: 1, usage: { input_tokens: 10, output_tokens: 5 }, malformedLines: 0 });
});

test('captured processes are stopped by the configured deadline', async () => {
  const result = await runCapturedProcess({
    executable: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 1000)'],
    cwd: process.cwd(),
    input: '',
    timeoutMs: 30,
  });
  assert.equal(result.timedOut, true);
  assert.ok(result.durationMs < 900);
});

test('captured process timeout does not block while stopping a child tree', async () => {
  const result = await runCapturedProcess({
    executable: process.execPath,
    args: ['-e', `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']); setTimeout(() => {}, 5000)`],
    cwd: process.cwd(),
    input: '',
    timeoutMs: 30,
  });
  assert.equal(result.timedOut, true);
  assert.ok(result.durationMs < 1_000);
});

test('captured process timeout resolves when an orphan keeps stdout open', async () => {
  const result = await runCapturedProcess({
    executable: process.execPath,
    args: ['-e', `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { detached: true, stdio: ['ignore', process.stdout, process.stderr] }); child.unref(); process.exit(0)`],
    cwd: process.cwd(),
    input: '',
    timeoutMs: 30,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.durationMs, 30);
});

test('captured processes persist stdout incrementally and parse complete lines', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lightbenchmark-stream-'));
  const stdoutFile = path.join(root, 'events.jsonl');
  const stderrFile = path.join(root, 'stderr.log');
  const lines = [];
  try {
    await Promise.all([writeFile(stdoutFile, ''), writeFile(stderrFile, '')]);
    const result = await runCapturedProcess({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("one\\n"); process.stdout.write("two")'],
      cwd: root,
      input: '',
      timeoutMs: 1_000,
      stdoutFile,
      stderrFile,
      onStdoutLine: line => lines.push(line),
    });
    assert.equal(result.exitCode, 0);
    assert.equal(await readFile(stdoutFile, 'utf8'), 'one\ntwo');
    assert.deepEqual(lines, ['one', 'two']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('candidate workspace excludes the benchmark repository', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lightbenchmark-source-'));
  let candidate;
  try {
    await Promise.all([
      mkdir(path.join(root, 'submission', 'site'), { recursive: true }),
      writeFile(path.join(root, 'prompt.txt'), 'prompt'),
      writeFile(path.join(root, 'public-tests.mjs'), '// public'),
      writeFile(path.join(root, 'showcase-smoke.mjs'), '// smoke'),
      writeFile(path.join(root, 'evaluate-submission.mjs'), '// private'),
    ]);
    candidate = await createCandidateWorkspace(root);
    assert.deepEqual((await readdir(candidate)).sort(), ['prompt.txt', 'public-tests.mjs', 'showcase-smoke.mjs', 'submission']);
    assert.equal(await lstat(path.join(candidate, 'evaluate-submission.mjs')).catch(() => null), null);
  } finally {
    if (candidate) await rm(candidate, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('isolated Codex home carries authentication but no user instructions or skills', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'lightbenchmark-codex-source-'));
  let isolated;
  try {
    await Promise.all([
      writeFile(path.join(source, 'auth.json'), '{"token":"test"}'),
      writeFile(path.join(source, 'AGENTS.md'), 'personal instructions'),
      mkdir(path.join(source, 'skills')),
    ]);
    isolated = await createIsolatedCodexHome(source);
    assert.deepEqual(await readdir(isolated), ['auth.json']);
    assert.equal(await readFile(path.join(isolated, 'auth.json'), 'utf8'), '{"token":"test"}');
  } finally {
    if (isolated) await rm(isolated, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test('debug finalizer creates an append-only live showcase record', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lightbenchmark-finalize-'));
  const cohort = path.join(root, 'cohort');
  const workspace = path.join(cohort, 'prism-twist');
  const site = path.join(workspace, 'submission', 'site');
  const runsDir = path.join(root, 'runs');
  try {
    const payload = await buildPromptPayload('prism-twist');
    const promptHash = createHash('sha256').update(JSON.stringify(payload.sequence)).digest('hex');
    const fixture = { seeds: [{ seed: 0, length: 25 }], algorithms: [["R", "U", "R'", "U'"]] };
    const fixtureHash = createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
    const evaluatorFiles = ['scripts/evaluate-submission.mjs', 'evaluator/cube.mjs'];
    const evaluatorBytes = await Promise.all([
      readFile(new URL('../scripts/evaluate-submission.mjs', import.meta.url)),
      readFile(new URL('../evaluator/cube.mjs', import.meta.url)),
    ]);
    const evaluatorHash = createHash('sha256').update(evaluatorBytes.map((bytes, index) => `${evaluatorFiles[index]}\0${createHash('sha256').update(bytes).digest('hex')}`).join('\n')).digest('hex');
    await Promise.all([mkdir(site, { recursive: true }), mkdir(runsDir), mkdir(path.join(cohort, '.fixtures'), { recursive: true })]);
    await Promise.all([
      cp(new URL('../evaluator/cube.mjs', import.meta.url), path.join(site, 'engine.mjs')),
      writeFile(path.join(site, 'index.html'), '<!doctype html><title>demo</title>'),
      writeFile(path.join(workspace, 'public-tests.mjs'), '// fixture'),
      writeFile(path.join(workspace, 'payload.json'), JSON.stringify(payload)),
      writeFile(path.join(cohort, 'commitment.json'), JSON.stringify({ prompts: { 'prism-twist': promptHash }, evaluators: { 'prism-twist': evaluatorHash }, fixtures: { 'prism-twist': fixtureHash } })),
      writeFile(path.join(cohort, '.fixtures', 'prism-twist.json'), JSON.stringify({ taskId: 'prism-twist', fixture })),
      writeFile(path.join(workspace, 'codex-events.jsonl'), `${JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'Get-Content C:\\\\repo\\\\evaluator\\\\cube.mjs; Get-Content C:\\\\Users\\\\test\\\\.codex\\\\skills\\\\demo\\\\SKILL.md' } })}\n${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } })}\n`),
      writeFile(path.join(workspace, 'codex-run.json'), JSON.stringify({
        schemaVersion: 1,
        harness: 'codex-cli-agent',
        isolation: 'same-host-debug',
        cliVersion: 'codex-test',
        modelRequested: 'gpt-5.6-luna',
        reasoningEffortRequested: 'max',
        startedAt: new Date(Date.now() - 1_000).toISOString(),
        endedAt: null,
        durationMs: null,
        terminationReason: 'running',
        itemCount: 0,
        toolCalls: 0,
        subagents: 0,
        malformedLines: 0,
        usage: null,
      })),
    ]);
    const result = await finalizeDebugRun({
      workspace,
      workRoot: root,
      runsDir,
      runId: 'debug-test-prism-twist',
      cohortId: 'debug-test',
      browserSmoke: async (_taskId, _site, { artifactsDir }) => {
        await mkdir(artifactsDir, { recursive: true });
        await Promise.all(['before.png', 'middle.png', 'after.png'].map(name => writeFile(path.join(artifactsDir, name), name)));
        return { pass: true, frameChanged: true };
      },
    });
    assert.equal(result.run.showcase.kind, 'live');
    assert.equal(result.run.usage.total.totalTokens, 15);
    assert.equal(result.run.agents.spawned, 0);
    assert.equal(result.run.execution.terminationReason, 'finalized-incomplete');
    assert.equal(result.run.execution.toolCalls, 1);
    assert.deepEqual(result.run.execution.benchmarkRepositoryExposure, ['independent evaluator source']);
    assert.deepEqual(result.run.execution.externalContextExposure, ['user skill instructions']);
    assert.match(result.run.evaluation.comparabilityBlockers.join('\n'), /benchmark非公開ファイル/u);
    assert.match(result.run.evaluation.comparabilityBlockers.join('\n'), /ユーザー文脈/u);
    assert.equal((await readFile(path.join(result.target, 'run.json'), 'utf8')).includes('LIGHTBENCH-1'), true);
    await assert.rejects(() => finalizeDebugRun({ workspace, workRoot: root, runsDir, runId: 'debug-test-prism-twist', cohortId: 'debug-test' }), /already exists/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
