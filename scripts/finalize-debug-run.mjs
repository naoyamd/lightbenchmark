import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateTurn1, evaluateTurn2 } from '../evaluator/chat.mjs';
import { validateRun } from './build-site.mjs';
import { evaluateSubmission } from './evaluate-submission.mjs';
import { consumeCodexLine, emptyCodexStats } from './run-codex-task.mjs';
import { smokeShowcase } from './showcase-smoke.mjs';

const scriptFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptFile), '..');
const codingTasks = new Set(['color-cascade-18', 'prism-twist', 'robot-arm-sort']);
const allowedShowcaseExtensions = new Set(['.html', '.css', '.js', '.mjs', '.json']);
const showcaseLimit = 2 * 1024 * 1024;
const sensitiveRepositoryPatterns = [
  ['independent evaluator source', /(?:^|[\\/])evaluator[\\/]+[^"'\s]+\.mjs/iu],
  ['evaluation harness', /(?:^|[\\/])scripts[\\/]+evaluate-submission\.mjs/iu],
  ['benchmark test suite', /(?:^|[\\/])tests[\\/]+[^"'\s]+\.test\.mjs/iu],
];
const externalContextPatterns = [
  ['global AGENTS.md', /(?:^|[\\/])\.codex[\\/]+AGENTS(?:\.override)?\.md/iu],
  ['user skill instructions', /(?:^|[\\/])\.codex[\\/]+skills[\\/]+[^"'\s]+SKILL\.md/iu],
];

const sha256 = value => createHash('sha256').update(value).digest('hex');
const fileHash = async file => sha256(await readFile(file));

async function publishStaging(source, target) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await rename(source, target); } catch (error) {
      if (error.code !== 'EPERM' || attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

async function evaluatorHash(taskId, legacyBufferJson = false, includeSmoke = true) {
  const files = taskId === 'japanese-chat'
    ? ['evaluator/chat.mjs']
    : ['scripts/evaluate-submission.mjs', `evaluator/${({ 'color-cascade-18': 'puyo', 'prism-twist': 'cube', 'robot-arm-sort': 'arm' })[taskId]}.mjs`];
  if (includeSmoke && taskId !== 'japanese-chat') files.splice(1, 0, 'scripts/showcase-smoke.mjs');
  return sha256((await Promise.all(files.map(file => readFile(path.join(projectRoot, file))))).map((bytes, index) => `${files[index]}\0${sha256(legacyBufferJson ? JSON.stringify(bytes) : bytes)}`).join('\n'));
}

function identifier(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(value) || value === '.' || value === '..') {
    throw new Error(`${name} must contain only letters, numbers, dot, underscore, and hyphen`);
  }
  return value;
}

async function regularFile(file) {
  const stat = await lstat(file).catch(() => null);
  return stat?.isFile() && !stat.isSymbolicLink() ? stat : null;
}

async function inspectShowcase(directory) {
  const files = [];
  let totalBytes = 0;
  const visit = async (current, prefix = '') => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.posix.join(prefix, entry.name);
      const stat = await lstat(absolute);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) throw new Error(`symlinkは公開できません: ${relative}`);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (!entry.isFile()) throw new Error(`通常ファイルではありません: ${relative}`);
      else {
        const extension = path.extname(entry.name).toLowerCase();
        if (!allowedShowcaseExtensions.has(extension)) throw new Error(`許可外ファイルです: ${relative}`);
        const bytes = await readFile(absolute);
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        totalBytes += stat.size;
        if (totalBytes > showcaseLimit) throw new Error('showcaseが2 MiBを超えています');
        files.push({ absolute, relative, size: stat.size, sha256: sha256(bytes) });
      }
    }
  };
  try {
    const info = await lstat(directory).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error('submission/siteがありません');
    await visit(directory);
    const index = files.find(file => file.relative === 'index.html');
    if (!index) throw new Error('UI未完成: submission/site/index.htmlがありません');
    const html = await readFile(index.absolute, 'utf8');
    if (/<base\b/iu.test(html)) throw new Error('index.htmlのbase要素は公開できません');
    if (/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy/iu.test(html)) {
      throw new Error('index.htmlの独自CSPは公開できません');
    }
    return {
      valid: true,
      files,
      totalBytes,
      hash: sha256(files.map(file => `${file.relative}\0${file.size}\0${file.sha256}`).join('\n')),
      reason: null,
    };
  } catch (error) {
    return { valid: false, files: [], totalBytes, hash: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

function unavailableBucket() {
  return { inputTokens: null, outputTokens: null, cachedTokens: null, reasoningTokens: null, totalTokens: null, cost: null, currency: null, costStatus: 'unavailable' };
}

function zeroBucket() {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0, cost: 0, currency: null, costStatus: 'none' };
}

function normalizedUsage(usage) {
  if (!usage || typeof usage !== 'object') return unavailableBucket();
  const inputTokens = usage.inputTokens ?? usage.input_tokens ?? null;
  const outputTokens = usage.outputTokens ?? usage.output_tokens ?? null;
  const cachedTokens = usage.cachedTokens ?? usage.cached_input_tokens ?? usage.input_tokens_details?.cached_tokens ?? null;
  const reasoningTokens = usage.reasoningTokens ?? usage.reasoning_output_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? null;
  const totalTokens = usage.totalTokens ?? usage.total_tokens
    ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  return { inputTokens, outputTokens, cachedTokens, reasoningTokens, totalTokens, cost: null, currency: null, costStatus: 'unavailable' };
}

function usageRecord(usage, spawned) {
  const total = normalizedUsage(usage);
  if (spawned === 0) return { root: { ...total }, subagents: zeroBucket(), total };
  return { root: unavailableBucket(), subagents: unavailableBucket(), total };
}

function observedLimits(metadata, usage) {
  const steps = metadata.itemCount ?? null;
  const outputTokens = usage.total.outputTokens;
  return {
    wallClock: { limitMs: 720_000, enforcement: 'hard', observedMs: metadata.durationMs ?? null, withinLimit: metadata.durationMs === null ? null : metadata.durationMs <= 720_000 },
    agentSteps: { limit: 24, enforcement: 'observed-only', observed: steps, withinLimit: steps === null ? null : steps <= 24 },
    outputTokens: { limit: 20_000, enforcement: 'observed-only', observed: outputTokens, withinLimit: outputTokens === null ? null : outputTokens <= 20_000 },
  };
}

async function buildEvaluation(taskId, workspace, runner, showcaseState, fixtureFile, fixture, replay, experience) {
  const common = {
    status: 'debug-only',
    showcase: showcaseState,
    replay,
    experience,
    fixture: { sha256: sha256(JSON.stringify(fixture)) },
    comparabilityBlockers: ['同一ホストのdebug実行で、正式比較用の隔離laneではありません。'],
    measurementFailures: [],
  };
  if (runner.error) common.measurementFailures.push(runner.error);
  if (runner.malformedLines) common.measurementFailures.push(`Codex JSONL malformed lines: ${runner.malformedLines}`);
  if (runner.commandPolicyBlocks) common.measurementFailures.push(`Codex command policy blocks: ${runner.commandPolicyBlocks}`);
  if (runner.sensitiveRepositoryReads?.length) {
    common.comparabilityBlockers.push(`候補がbenchmark非公開ファイルを参照しました: ${runner.sensitiveRepositoryReads.join(', ')}`);
  }
  if (runner.externalContextReads?.length) {
    common.comparabilityBlockers.push(`候補が比較条件外のユーザー文脈を参照しました: ${runner.externalContextReads.join(', ')}`);
  }

  if (taskId === 'japanese-chat') {
    const firstFile = path.join(workspace, 'turn1-response.txt');
    const secondFile = path.join(workspace, 'turn2-response.txt');
    const [first, second] = await Promise.all([
      regularFile(firstFile).then(stat => stat ? readFile(firstFile, 'utf8') : null),
      regularFile(secondFile).then(stat => stat ? readFile(secondFile, 'utf8') : null),
    ]);
    const deterministicChecks = first && second ? { turn1: evaluateTurn1(first), turn2: evaluateTurn2(second) } : null;
    const truthPass = Boolean(deterministicChecks?.turn1?.truthPass && deterministicChecks?.turn2?.truthPass);
    return {
      ...common,
      deterministicChecks,
      headline: { pass: truthPass, reason: !first || !second ? '2ターンの回答が揃っていません' : truthPass ? '8事実と訂正を確認しました' : '事実判定または訂正に誤りがあります' },
      logic: { pass: truthPass },
      robustness: { pass: Boolean(deterministicChecks?.turn2?.truthPass) },
    };
  }

  try {
    const independentEvaluator = await evaluateSubmission(taskId, path.join(workspace, 'submission', 'site'), fixtureFile);
    return {
      ...common,
      independentEvaluator,
      headline: { pass: independentEvaluator.headlinePass },
      logic: { pass: independentEvaluator.logicPass },
      robustness: { pass: independentEvaluator.robustnessPass },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ...common,
      independentEvaluator: null,
      headline: { pass: false, reason },
      logic: { pass: false, reason: '評価を完走できませんでした' },
      robustness: { pass: false, reason: '評価を完走できませんでした' },
      measurementFailures: [...common.measurementFailures, `independent evaluator: ${reason}`],
    };
  }
}

async function recoverRunner(workspace, taskId, recorded) {
  let eventInfo = null;
  let recovered = { ...recorded };
  if (taskId !== 'japanese-chat') {
    const eventFile = path.join(workspace, 'codex-events.jsonl');
    const stats = emptyCodexStats();
    let sensitiveRepositoryReads = [];
    let externalContextReads = [];
    eventInfo = await regularFile(eventFile);
    if (eventInfo) {
      const events = await readFile(eventFile, 'utf8');
      for (const line of events.split(/\r?\n/u)) consumeCodexLine(stats, line);
      sensitiveRepositoryReads = sensitiveRepositoryPatterns
        .filter(([, pattern]) => pattern.test(events))
        .map(([label]) => label);
      externalContextReads = externalContextPatterns
        .filter(([, pattern]) => pattern.test(events))
        .map(([label]) => label);
    }
    recovered = {
      ...recorded,
      threadId: recorded.threadId ?? stats.threadId,
      itemCount: Math.max(recorded.itemCount ?? 0, stats.itemCount),
      toolCalls: Math.max(recorded.toolCalls ?? 0, stats.toolCalls),
      subagents: Math.max(recorded.subagents ?? 0, stats.subagents),
      usage: recorded.usage ?? stats.usage,
      malformedLines: Math.max(recorded.malformedLines ?? 0, stats.malformedLines),
      sensitiveRepositoryReads,
      externalContextReads,
    };
    const stderr = await readFile(path.join(workspace, 'codex-stderr.log'), 'utf8').catch(() => '');
    recovered.commandPolicyBlocks = (stderr.match(/rejected: blocked by policy/gu) ?? []).length;
  } else {
    const responseStats = await Promise.all(['turn1-response.txt', 'turn2-response.txt'].map(file => regularFile(path.join(workspace, file))));
    eventInfo = responseStats.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
  }
  if (recorded.terminationReason === 'running' || !recorded.endedAt) {
    const started = Date.parse(recorded.startedAt);
    const observedEnd = eventInfo?.mtimeMs ?? Date.now();
    const ended = new Date(Number.isFinite(started) ? Math.max(started, observedEnd) : observedEnd);
    recovered.endedAt = ended.toISOString();
    recovered.durationMs = Number.isFinite(started) ? ended.getTime() - started : null;
    recovered.terminationReason = 'finalized-incomplete';
    recovered.error = recorded.error ?? 'runner ended before final metadata was written';
  }
  return recovered;
}

export async function finalizeDebugRun({ workspace, runId, cohortId, runsDir = path.join(projectRoot, 'runs'), workRoot = path.join(projectRoot, 'work'), timeZone = 'Asia/Tokyo', browserSmoke = smokeShowcase }) {
  const root = path.resolve(workspace);
  const taskId = path.basename(root);
  if (taskId !== 'japanese-chat' && !codingTasks.has(taskId)) throw new Error(`unknown task directory: ${taskId}`);
  identifier(runId, 'runId');
  identifier(cohortId, 'cohortId');
  const workspaceInfo = await lstat(root).catch(() => null);
  if (!workspaceInfo?.isDirectory()) throw new Error(`workspace does not exist: ${root}`);
  const relativeWork = path.relative(path.resolve(workRoot), root);
  const workSegments = relativeWork.split(path.sep);
  if (relativeWork.startsWith('..') || path.isAbsolute(relativeWork) || workSegments.length !== 2 || workSegments.some(segment => !segment)) {
    throw new Error('workspace must be work/<fresh-cohort>/<task-id>');
  }
  const outputRoot = path.resolve(runsDir);
  const target = path.join(outputRoot, runId);
  if (await lstat(target).catch(() => null)) throw new Error(`run already exists: ${target}`);

  const runnerFile = path.join(root, taskId === 'japanese-chat' ? 'chat-api-run.json' : 'codex-run.json');
  let runner = JSON.parse(await readFile(runnerFile, 'utf8'));
  const payload = JSON.parse(await readFile(path.join(root, 'payload.json'), 'utf8'));
  const promptHash = sha256(JSON.stringify(payload.sequence));
  const commitment = JSON.parse(await readFile(path.join(root, '..', 'commitment.json'), 'utf8'));
  if (commitment.prompts?.[taskId] !== promptHash) throw new Error('payload does not match the fresh workspace commitment');
  const fixtureFile = path.join(root, '..', '.fixtures', `${taskId}.json`);
  const sealedFixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
  const fixtureHash = sha256(JSON.stringify(sealedFixture.fixture));
  if (commitment.fixtures?.[taskId] !== fixtureHash) throw new Error('fixture does not match the fresh workspace commitment');
  const commitmentVersion = commitment.schemaVersion ?? 0;
  const currentEvaluatorHash = await evaluatorHash(taskId, commitmentVersion === 2, commitmentVersion >= 3);
  if (commitment.evaluators?.[taskId] !== currentEvaluatorHash) throw new Error('evaluator does not match the fresh workspace commitment');
  runner = await recoverRunner(root, taskId, runner);
  const spawned = runner.subagents ?? 0;
  const usage = usageRecord(runner.usage, spawned);
  const limits = observedLimits(runner, usage);
  const staging = path.join(outputRoot, `_staging-${runId}-${randomUUID()}`);
  await mkdir(staging, { recursive: false });
  let showcase = null;
  let showcaseState = { available: false, reason: null };
  let candidateSiteHash = null;
  let replay = null;
  const visualReviewFile = path.join(root, 'visual-review.json');
  const interventionsFile = path.join(root, 'interventions.json');
  const experience = await regularFile(visualReviewFile)
    ? JSON.parse(await readFile(visualReviewFile, 'utf8'))
    : { status: 'unreviewed', checks: null, notes: '人手による視覚評価は未実施です' };
  const interventions = await regularFile(interventionsFile)
    ? JSON.parse(await readFile(interventionsFile, 'utf8'))
    : [];
  if (!Array.isArray(interventions)) throw new Error('interventions.json must contain an array');
  const artifacts = [];
  try {
    if (taskId === 'japanese-chat') {
      const turnFiles = ['turn1-response.txt', 'turn2-response.txt'];
      const stats = await Promise.all(turnFiles.map(file => regularFile(path.join(root, file))));
      if (stats.every(stat => stat && stat.size <= 65_536)) {
        await mkdir(path.join(staging, 'showcase'));
        await Promise.all(turnFiles.map((file, index) => cp(path.join(root, file), path.join(staging, 'showcase', `turn-${index + 1}.txt`))));
        showcase = {
          kind: 'chat',
          turns: [
            { label: '閉本回答', path: 'showcase/turn-1.txt' },
            { label: '訂正回答', path: 'showcase/turn-2.txt' },
          ],
        };
        showcaseState = { available: true, reason: null };
      } else {
        showcaseState.reason = runner.terminationReason === 'harness-error'
          ? `未取得（ハーネスエラー: ${runner.error ?? 'unknown'}）`
          : '回答未取得または64 KiB超過のため表示できません';
      }
    } else {
      const candidate = await inspectShowcase(path.join(root, 'submission', 'site'));
      candidateSiteHash = candidate.hash;
      if (candidate.valid) {
        try {
          const smokeDir = path.join(root, '.smoke');
          replay = await browserSmoke(taskId, path.join(root, 'submission', 'site'), { artifactsDir: smokeDir });
          await mkdir(path.join(staging, 'artifacts'));
          for (const name of ['before.png', 'middle.png', 'after.png']) {
            await cp(path.join(smokeDir, name), path.join(staging, 'artifacts', name));
            artifacts.push({ kind: 'image', path: `artifacts/${name}`, label: `browser smoke ${name.replace('.png', '')}` });
          }
        } catch (error) {
          replay = { pass: false, error: error instanceof Error ? error.message : String(error) };
        }
        await cp(path.join(root, 'submission', 'site'), path.join(staging, 'showcase'), { recursive: true, errorOnExist: true, force: false });
        showcase = { kind: 'live', entry: 'showcase/index.html', protocol: 'LIGHTBENCH-1', scenario: 'public-v1' };
        showcaseState = { available: true, reason: null };
      } else {
        showcaseState.reason = candidate.reason;
      }
    }

    const evaluation = await buildEvaluation(taskId, root, runner, showcaseState, fixtureFile, sealedFixture.fixture, replay, experience);
    if (replay?.pass === false) evaluation.measurementFailures.push(`browser smoke: ${replay.error ?? replay.errors?.join(', ') ?? 'failed'}`);
    if (usage.total.totalTokens === null) evaluation.measurementFailures.push('token usage was not reported');
    if (runner.terminationReason !== 'completed') evaluation.measurementFailures.push(`runner termination: ${runner.terminationReason ?? 'unknown'}`);
    for (const [name, item] of Object.entries(limits)) {
      if (item.withinLimit === false) evaluation.comparabilityBlockers.push(`${name} budget exceeded`);
    }
    const modelId = runner.modelReturned ?? runner.modelRequested ?? 'unknown';
    const completed = runner.terminationReason === 'completed';
    const starterFile = path.join(root, 'public-tests.mjs');
    const hashes = {
      prompt: promptHash,
      starter: await regularFile(starterFile) ? await fileHash(starterFile) : null,
      candidateSite: candidateSiteHash,
      evaluator: await fileHash(taskId === 'japanese-chat'
        ? path.join(projectRoot, 'evaluator', 'chat.mjs')
        : path.join(projectRoot, 'scripts', 'evaluate-submission.mjs')),
      evaluatorCommitment: currentEvaluatorHash,
      fixture: fixtureHash,
      cohortCommitment: sha256(JSON.stringify(commitment)),
      turn1Output: await regularFile(path.join(root, 'turn1-response.txt')) ? await fileHash(path.join(root, 'turn1-response.txt')) : null,
      turn2Output: await regularFile(path.join(root, 'turn2-response.txt')) ? await fileHash(path.join(root, 'turn2-response.txt')) : null,
    };
    const run = {
      schemaVersion: 1,
      runId,
      cohortId,
      taskId,
      runKind: 'debug',
      status: 'inconclusive',
      model: {
        displayName: modelId === 'gpt-5.6-luna' ? 'GPT-5.6 Luna' : modelId,
        provider: 'OpenAI',
        modelId,
        revision: runner.modelReturned ?? null,
        reasoning: { requested: runner.reasoningEffortRequested ?? runner.reasoningEffort ?? null, effective: completed ? (runner.reasoningEffortRequested ?? runner.reasoningEffort ?? null) : null },
      },
      execution: {
        startedAt: runner.startedAt ?? null,
        endedAt: runner.endedAt ?? null,
        timeZone,
        durationMs: runner.durationMs ?? null,
        agentSteps: runner.itemCount ?? null,
        toolCalls: runner.toolCalls ?? null,
        commandPolicyBlocks: runner.commandPolicyBlocks ?? 0,
        benchmarkRepositoryExposure: taskId === 'japanese-chat' ? [] : runner.sensitiveRepositoryReads ?? [],
        externalContextExposure: taskId === 'japanese-chat' ? [] : runner.externalContextReads ?? [],
        terminationReason: runner.terminationReason ?? 'unknown',
        lane: 'autonomous',
        harness: runner.cliVersion ? `${runner.harness} ${runner.cliVersion}` : runner.harness,
        isolation: runner.isolation,
        codexHomeIsolation: runner.codexHomeIsolation ?? null,
        limits,
      },
      usage,
      agents: spawned === 0
        ? { spawned: 0, completed: 0, failed: 0, maxConcurrent: 0, items: [] }
        : { spawned, completed: null, failed: null, maxConcurrent: null, items: null },
      interventions,
      artifacts,
      showcase,
      versions: {
        benchmark: '1.0.0',
        prompt: payload.promptVersion,
        commonPrompt: payload.commonVersion ?? null,
        runner: runner.cliVersion ?? runner.harness,
        evaluator: 'in-repository-v1',
        fixture: 'sealed-cohort-v1',
        replay: 'chromium-cdp-v1',
      },
      hashes,
      evaluation,
    };
    validateRun(run, `${runId}/run.json`);
    await writeFile(path.join(staging, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
    await publishStaging(staging, target);
    return { target, run };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function parseArgs(args) {
  const workspace = args.shift();
  if (!workspace) throw new Error('Usage: node scripts/finalize-debug-run.mjs <workspace> --run-id ID --cohort-id ID [--runs-dir PATH]');
  const options = { workspace };
  while (args.length) {
    const key = args.shift();
    const value = args.shift();
    if (!value) throw new Error(`${key} requires a value`);
    if (key === '--run-id') options.runId = value;
    else if (key === '--cohort-id') options.cohortId = value;
    else if (key === '--runs-dir') options.runsDir = value;
    else throw new Error(`unknown option: ${key}`);
  }
  if (!options.runId || !options.cohortId) throw new Error('--run-id and --cohort-id are required');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  finalizeDebugRun(parseArgs(process.argv.slice(2)))
    .then(({ target }) => console.log(JSON.stringify({ target }, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
