import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import { buildSite, validateRun } from '../scripts/build-site.mjs';

const workspaces = [];

const sampleRun = {
  schemaVersion: 1,
  runId: 'run-001',
  cohortId: 'cohort-a',
  taskId: 'task-a',
  runKind: 'official',
  status: 'pass',
  model: {
    displayName: 'Test model',
    provider: 'Test provider',
    modelId: 'test-model-1',
    revision: null,
    reasoning: 'low',
  },
  execution: {
    startedAt: '2026-08-27T00:00:00Z',
    endedAt: '2026-08-27T00:00:01Z',
    timeZone: 'UTC',
    durationMs: 1000,
    agentSteps: 2,
    toolCalls: 1,
    terminationReason: 'completed',
    lane: 'autonomous',
    harness: 'test-runner',
    isolation: 'isolated-candidate-workspace',
  },
  usage: {
    root: { inputTokens: 10, outputTokens: 20, cachedTokens: null, reasoningTokens: 4, totalTokens: 30, cost: 0.01, currency: 'USD', costStatus: 'estimated' },
    subagents: { inputTokens: null, outputTokens: null, cachedTokens: null, reasoningTokens: null, totalTokens: null, cost: null, currency: null, costStatus: 'unavailable' },
    total: { inputTokens: 10, outputTokens: 20, cachedTokens: null, reasoningTokens: 4, totalTokens: 30, cost: 0.01, currency: 'USD', costStatus: 'estimated' },
  },
  agents: {
    spawned: 0,
    completed: 0,
    failed: 0,
    maxConcurrent: 0,
    items: [],
  },
  interventions: [],
  artifacts: [],
  versions: { runner: 'test' },
  hashes: { input: 'abc' },
  evaluation: { status: 'ok' },
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'lightbenchmark-site-'));
  workspaces.push(root);
  await cp(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web'), path.join(root, 'web'), { recursive: true });
  await cp(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prompts'), path.join(root, 'prompts'), { recursive: true });
  return root;
}

async function writeRun(root, directory, run = sampleRun) {
  await mkdir(path.join(root, 'runs', directory), { recursive: true });
  await writeFile(path.join(root, 'runs', directory, 'run.json'), `${JSON.stringify(run)}\n`);
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('site build', () => {
  it('validates, copies assets, and writes deterministic run metadata', async () => {
    const root = await workspace();
    const artifactRun = clone(sampleRun);
    artifactRun.artifacts = [{ kind: 'image', path: 'artifacts/demo.png', label: 'デモ画像' }];
    await mkdir(path.join(root, 'runs', 'first', 'artifacts'), { recursive: true });
    await writeFile(path.join(root, 'runs', 'first', 'artifacts', 'demo.png'), 'not-a-real-png');
    await writeRun(root, 'first', artifactRun);
    await writeRun(root, '_example', { ...sampleRun, runId: '_example-run' });
    const result = await buildSite({ rootDir: root });
    const output = await readFile(path.join(root, 'dist', 'data', 'runs.json'), 'utf8');
    assert.equal(result.count, 1);
    assert.doesNotMatch(output, /_example-run/);
    assert.deepEqual(JSON.parse(output)[0].runId, 'run-001');
    assert.match(await readFile(path.join(root, 'dist', 'index.html'), 'utf8'), /LightBenchmark Results/);
    assert.match(await readFile(path.join(root, 'dist', 'prompts', 'prism-twist.prompt.json'), 'utf8'), /Prism Twist/);
    assert.match(await readFile(path.join(root, 'dist', 'prompts', 'prism-twist.prompt.txt'), 'utf8'), /\[USER\][\s\S]*Prism Twist/);
    assert.match(await readFile(path.join(root, 'dist', 'prompts', 'prism-twist.prompt.html'), 'utf8'), /<pre>[\s\S]*Prism Twist/);
    const app = await readFile(path.join(root, 'dist', 'app.js'), 'utf8');
    for (const label of ['モデル', '合計トークン', 'サブエージェント', '実行時間', 'コスト']) assert.match(app, new RegExp(label));
    assert.match(app, /artifactGallery/);
    assert.match(await readFile(path.join(root, 'dist', 'artifacts', 'run-001', 'artifacts', 'demo.png'), 'utf8'), /not-a-real-png/);
    assert.equal(JSON.parse(output)[0].artifacts[0].url, './artifacts/run-001/artifacts/demo.png');
    assert.match(output, /"cachedTokens": null/);
    assert.doesNotMatch(output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await buildSite({ rootDir: root });
    assert.equal(await readFile(path.join(root, 'dist', 'data', 'runs.json'), 'utf8'), output);
  });
});

describe('run schema', () => {
  it('accepts the complete schema and keeps unavailable values as null', () => {
    const run = validateRun(clone(sampleRun));
    assert.equal(run.model.revision, null);
    assert.equal(run.usage.subagents.totalTokens, null);
    assert.deepEqual(run.interventions, []);
    assert.deepEqual(run.artifacts, []);
  });

  it('rejects traversal, invalid dates, and negative values', () => {
    const traversal = clone(sampleRun);
    traversal.runId = '../outside';
    assert.throws(() => validateRun(traversal), /path traversal/);

    const invalidDate = clone(sampleRun);
    invalidDate.execution.startedAt = 'not-a-date';
    assert.throws(() => validateRun(invalidDate), /valid date/);

    const negative = clone(sampleRun);
    negative.execution.durationMs = -1;
    assert.throws(() => validateRun(negative), /non-negative|negative/);

    const unsafeArtifact = clone(sampleRun);
    unsafeArtifact.artifacts = [{ kind: 'image', path: '../private.png', label: null }];
    assert.throws(() => validateRun(unsafeArtifact), /relative paths/);

    const signedResult = clone(sampleRun);
    signedResult.evaluation = { finalX: -2.4, finalVy: -1.2 };
    assert.doesNotThrow(() => validateRun(signedResult));

    const wrongTotal = clone(sampleRun);
    wrongTotal.usage.subagents.inputTokens = 2;
    wrongTotal.usage.total.inputTokens = 10;
    assert.throws(() => validateRun(wrongTotal), /double counting/);

    const unnamed = clone(sampleRun);
    unnamed.model.displayName = null;
    assert.throws(() => validateRun(unnamed), /must be recorded/);

    const debugPass = clone(sampleRun);
    debugPass.runKind = 'debug';
    assert.throws(() => validateRun(debugPass), /debug runs must be inconclusive/);

    const wrongDuration = clone(sampleRun);
    wrongDuration.execution.durationMs = 9000;
    assert.throws(() => validateRun(wrongDuration), /must match startedAt/);
  });

  it('allows missing measurements only on inconclusive debug runs', () => {
    const run = clone(sampleRun);
    run.runKind = 'debug';
    run.status = 'inconclusive';
    run.execution.startedAt = null;
    run.execution.durationMs = null;
    assert.doesNotThrow(() => validateRun(run));

    const unisolatedOfficial = clone(sampleRun);
    unisolatedOfficial.execution.isolation = 'same-host-debug';
    assert.throws(() => validateRun(unisolatedOfficial), /official runs require an isolated execution lane/);
  });

  it('rejects duplicate run IDs during build', async () => {
    const root = await workspace();
    await writeRun(root, 'one');
    await writeRun(root, 'two');
    await assert.rejects(() => buildSite({ rootDir: root }), /duplicate runId/);
  });

  it('never deletes a dist target outside the project root', async () => {
    const root = await workspace();
    await writeRun(root, 'one');
    await assert.rejects(
      () => buildSite({ rootDir: root, distDir: path.join(tmpdir(), 'lightbenchmark-outside') }),
      /child of the project root/,
    );
  });
});
