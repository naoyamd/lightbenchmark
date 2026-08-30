import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
    assert.match(await readFile(path.join(root, 'dist', 'index.html'), 'utf8'), /結果を先に、/);
    assert.match(await readFile(path.join(root, 'dist', 'prompts', 'prism-twist.prompt.json'), 'utf8'), /3×3 ルービックキューブ/);
    assert.match(await readFile(path.join(root, 'dist', 'prompts', 'prism-twist.prompt.txt'), 'utf8'), /\[USER\][\s\S]*3×3 ルービックキューブ/);
    assert.match(await readFile(path.join(root, 'dist', 'prompts', 'prism-twist.prompt.html'), 'utf8'), /<pre>[\s\S]*3×3 ルービックキューブ/);
    const modelPage = await readFile(path.join(root, 'dist', 'models', 'test-model-1', 'index.html'), 'utf8');
    assert.match(modelPage, /<base href="\.\.\/\.\.\/">/);
    assert.match(modelPage, /<body data-model-id="test-model-1">/);
    assert.equal(JSON.parse(output)[0].model.pageUrl, './models/test-model-1/');
    const app = await readFile(path.join(root, 'dist', 'app.js'), 'utf8');
    for (const label of ['モデル', '合計トークン', 'サブエージェント', '実行時間', 'コスト']) assert.match(app, new RegExp(label));
    for (const label of ['ぷよぷよ風・18連鎖全消し', '3×3 ルービックキューブ', '2リンク・ロボットアーム仕分け']) assert.match(app, new RegExp(label));
    assert.match(app, /artifactGallery/);
    assert.match(app, /ビジュアル未収録/);
    assert.match(app, /evaluation\?\.showcase\?\.reason/);
    assert.match(output, /"showcase": null/);
    assert.match(await readFile(path.join(root, 'dist', 'artifacts', 'run-001', 'artifacts', 'demo.png'), 'utf8'), /not-a-real-png/);
    assert.equal(JSON.parse(output)[0].artifacts[0].url, './artifacts/run-001/artifacts/demo.png');
    assert.match(output, /"cachedTokens": null/);
    assert.doesNotMatch(output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await buildSite({ rootDir: root });
    assert.equal(await readFile(path.join(root, 'dist', 'data', 'runs.json'), 'utf8'), output);
  });

  it('builds the finalizer live shape and two-turn chat showcase shape', async () => {
    const root = await workspace();
    const liveRun = clone(sampleRun);
    liveRun.showcase = { kind: 'live', entry: 'showcase/index.html', protocol: 'LIGHTBENCH-1', scenario: 'public-v1' };
    await mkdir(path.join(root, 'runs', 'first', 'showcase'), { recursive: true });
    await writeFile(path.join(root, 'runs', 'first', 'showcase', 'index.html'), '<!doctype html><html><head><title>Live</title></head><body>ok</body></html>');
    await writeFile(path.join(root, 'runs', 'first', 'showcase', 'nested.html'), '<!doctype html><script>fetch("https://example.com")</script>');
    await writeFile(path.join(root, 'runs', 'first', 'showcase', 'app.js'), 'window.__LIGHTBENCH__ = { reset() {}, runChallenge() {} };');
    await writeRun(root, 'first', liveRun);

    const chatRun = clone(sampleRun);
    chatRun.runId = 'run-002';
    chatRun.showcase = {
      kind: 'chat',
      turns: [
        { label: '閉本回答', path: 'showcase/turn-1.txt' },
        { label: '訂正回答', path: 'showcase/turn-2.txt' },
      ],
    };
    await mkdir(path.join(root, 'runs', 'second'), { recursive: true });
    await mkdir(path.join(root, 'runs', 'second', 'showcase'), { recursive: true });
    await writeFile(path.join(root, 'runs', 'second', 'showcase', 'turn-1.txt'), '<script>alert(1)</script>\n返答');
    await writeFile(path.join(root, 'runs', 'second', 'showcase', 'turn-2.txt'), '訂正しました');
    await writeRun(root, 'second', chatRun);

    await buildSite({ rootDir: root });
    const output = JSON.parse(await readFile(path.join(root, 'dist', 'data', 'runs.json'), 'utf8'));
    const builtLive = await readFile(path.join(root, 'dist', 'showcases', 'run-001', 'showcase', 'index.html'), 'utf8');
    assert.match(builtLive, /Content-Security-Policy/);
    assert.match(builtLive, /default-src 'none'/);
    assert.match(builtLive, /connect-src __LIGHTBENCH_ASSET_ROOT_9b41c8__/);
    assert.match(builtLive, /data-lightbenchmark-base/);
    for (const directive of ["worker-src 'none'", "frame-src 'none'", "form-action 'none'", "object-src 'none'"]) assert.match(builtLive, new RegExp(directive));
    assert.match(builtLive, /LIGHTBENCH-1/);
    assert.match(builtLive, /event\.source !== window\.parent/);
    assert.match(builtLive, /data\.nonce !== nonce/);
    const app = await readFile(path.join(root, 'dist', 'app.js'), 'utf8');
    assert.match(app, /setAttribute\('sandbox', 'allow-scripts'\)/);
    assert.match(app, /setAttribute\('referrerpolicy', 'no-referrer'\)/);
    assert.match(app, /event\.source !== frame\.contentWindow/);
    assert.match(app, /data\.nonce !== session\.nonce/);
    assert.match(app, /frame\.srcdoc = source\.replaceAll/);
    assert.match(app, /new URL\(url, document\.baseURI\)/);
    assert.match(app, /await fetch\(requestedUrl\.href/);
    assert.match(app, /source\.includes\(marker\)/);
    assert.match(app, /visual\.replaceChildren\(frame\)/);
    assert.match(app, /for \(const action of plan\.prepare\)/);
    assert.match(app, /for \(const action of plan\.run\)/);
    assert.doesNotMatch(app, /allow-same-origin/);
    for (const label of ['18連鎖を実行', 'キューブを解く', '自動仕分けを実行']) assert.match(app, new RegExp(label));
    assert.match(app, /停止する/);
    assert.match(app, /mountModelShowcases/);
    assert.match(app, /mountShowcase\(run, container\)/);
    assert.match(app, /new IntersectionObserver/);
    assert.match(app, /await waitForShowcaseVisibility\(session\)/);
    assert.match(app, /prepare: \['reset'\]/);
    assert.match(app, /prepare: \['reset', 'scramble'\]/);
    assert.match(app, /run: \['runChallenge'\]/);
    assert.match(app, /run: \['play'\]/);
    assert.match(app, /run: \['run'\]/);
    assert.match(app, /button\.disabled = true/);
    assert.match(app, /button\.disabled = false/);
    assert.match(app, /releaseShowcaseBridge/);
    assert.match(app, /responseUrl\.origin !== requestedUrl\.origin/);
    assert.match(app, /60_000/);
    assert.match(app, /部分達成/);
    assert.match(app, /escapeHtml\(typeof turn\.text/);
    assert.match(app, /detailShowcase = showcaseKind\(run\) === 'chat'/);
    assert.equal(output[0].showcase.url, './showcases/run-001/showcase/index.html');
    assert.deepEqual(output[1].showcase.turns.map(turn => turn.label), ['閉本回答', '訂正回答']);
    assert.equal(output[1].showcase.turns[0].text, '<script>alert(1)</script>\n返答');
    assert.equal(output[1].showcase.turns[1].text, '訂正しました');
    assert.equal(output[1].showcase.urls.length, 2);
    const nested = await readFile(path.join(root, 'dist', 'showcases', 'run-001', 'showcase', 'nested.html'), 'utf8');
    assert.match(nested, /Content-Security-Policy/);
    assert.doesNotMatch(nested, /LIGHTBENCH-1/);
    assert.equal(await readFile(path.join(root, 'dist', 'showcases', 'run-002', 'showcase', 'turn-2.txt'), 'utf8'), '訂正しました');
  });

  it('rejects unsafe live showcase paths, files, size, markup, and symlinks', async () => {
    const traversal = clone(sampleRun);
    traversal.showcase = { kind: 'live', entry: '../index.html' };
    assert.throws(() => validateRun(traversal), /relative paths/);

    for (const [name, setup, expected] of [
      ['base', dir => writeFile(path.join(dir, 'index.html'), '<base href="/">'), /<base>/],
      ['csp', dir => writeFile(path.join(dir, 'index.html'), '<meta http-equiv="Content-Security-Policy" content="default-src *">'), /existing Content-Security-Policy/],
      ['extension', async dir => { await writeFile(path.join(dir, 'index.html'), 'ok'); await writeFile(path.join(dir, 'bad.png'), 'nope'); }, /live showcase files/],
      ['size', async dir => { await writeFile(path.join(dir, 'index.html'), 'ok'); await writeFile(path.join(dir, 'huge.js'), 'x'.repeat(2 * 1024 * 1024)); }, /exceeds 2 MiB/],
      ['symlink', async dir => { await writeFile(path.join(dir, 'index.html'), 'ok'); await mkdir(path.join(dir, 'target')); await writeFile(path.join(dir, 'target', 'app.js'), 'ok'); await symlink(path.join(dir, 'target'), path.join(dir, 'link'), 'junction'); }, /symlinks/],
    ]) {
      const root = await workspace();
      const run = clone(sampleRun);
      run.showcase = { kind: 'live', entry: 'showcase/index.html' };
      const dir = path.join(root, 'runs', name, 'showcase');
      await mkdir(dir, { recursive: true });
      await setup(dir);
      await writeRun(root, name, run);
      await assert.rejects(() => buildSite({ rootDir: root }), expected);
    }
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

    const incompleteAgents = clone(run);
    incompleteAgents.agents.completed = null;
    incompleteAgents.agents.failed = null;
    incompleteAgents.agents.maxConcurrent = null;
    assert.doesNotThrow(() => validateRun(incompleteAgents));

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
