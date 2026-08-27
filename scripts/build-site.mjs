import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkTaskIds, buildPromptPayload, formatPromptText } from './prompt-payload.mjs';

const scriptFile = fileURLToPath(import.meta.url);
export const projectRoot = path.resolve(path.dirname(scriptFile), '..');

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isContainer = value => isObject(value) || Array.isArray(value);
const statuses = new Set(['pass', 'partial', 'candidate-fail', 'infra-error', 'inconclusive']);

const usageFields = [
  ['inputTokens', ['inputTokens', 'input']],
  ['outputTokens', ['outputTokens', 'output']],
  ['cachedTokens', ['cachedTokens', 'cached']],
  ['reasoningTokens', ['reasoningTokens', 'reasoning']],
  ['totalTokens', ['totalTokens', 'total']],
  ['cost', ['cost']],
  ['currency', ['currency']],
  ['costStatus', ['costStatus']],
];

const artifactExtensions = {
  image: new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']),
  video: new Set(['.m4v', '.mov', '.mp4', '.ogv', '.webm']),
};

function fail(location, message) {
  throw new Error(`${location}: ${message}`);
}

function requireKey(value, key, location) {
  if (!own(value, key)) fail(location, `missing ${key}`);
  return value[key];
}

function nullableString(value, location) {
  if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
    fail(location, 'expected a non-empty string or null');
  }
  return value;
}

function requiredString(value, location) {
  nullableString(value, location);
  if (value === null) fail(location, 'must be recorded');
  return value;
}

function identifier(value, location) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(location, 'expected a non-empty identifier');
  }
  if (value.includes('\0') || value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    fail(location, 'path traversal is not allowed');
  }
  return value;
}

function nullableNumber(value, location, integer = false) {
  if (value === null) return value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    fail(location, 'expected a finite non-negative number or null');
  }
  return value;
}

function requiredNumber(value, location, integer = false) {
  nullableNumber(value, location, integer);
  if (value === null) fail(location, 'must be recorded');
  return value;
}

function relativeAssetPath(value, location) {
  if (typeof value !== 'string' || value.trim() === '') fail(location, 'expected a non-empty relative path');
  const normalized = value.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    /^[A-Za-z][A-Za-z+.-]*:\/\//.test(normalized) ||
    normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) {
    fail(location, 'only relative paths are allowed');
  }
  return normalized;
}

function validateArtifacts(value, location) {
  if (value === undefined) return [];
  if (value === null) return null;
  if (!Array.isArray(value)) fail(location, 'expected an array or null');
  const seen = new Set();
  return value.map((artifact, index) => {
    const itemLocation = `${location}[${index}]`;
    if (!isObject(artifact)) fail(itemLocation, 'expected an object');
    const kind = requireKey(artifact, 'kind', itemLocation);
    if (kind !== 'image' && kind !== 'video') fail(`${itemLocation}.kind`, 'expected image or video');
    const assetPath = relativeAssetPath(requireKey(artifact, 'path', itemLocation), `${itemLocation}.path`);
    const extension = path.extname(assetPath).toLowerCase();
    if (!artifactExtensions[kind].has(extension)) fail(`${itemLocation}.path`, `unsupported ${kind} file type`);
    if (seen.has(assetPath)) fail(`${itemLocation}.path`, `duplicate artifact path: ${assetPath}`);
    seen.add(assetPath);
    const normalized = { ...artifact, kind, path: assetPath };
    normalized.label = nullableString(own(artifact, 'label') ? artifact.label : null, `${itemLocation}.label`);
    return normalized;
  });
}

function dateValue(value, location) {
  if (value === null) return value;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail(location, 'expected a valid date-time string or null');
  }

  // Date.parse normalizes impossible days such as 2024-02-30, so check the
  // calendar date portion before accepting the value.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
      calendar.getUTCFullYear() !== Number(year) ||
      calendar.getUTCMonth() !== Number(month) - 1 ||
      calendar.getUTCDate() !== Number(day)
    ) {
      fail(location, 'expected a valid calendar date');
    }
  }
  return value;
}

function validateUsageBucket(bucket, location) {
  if (!isObject(bucket)) fail(location, 'expected an object');
  const normalized = {};
  for (const [canonical, candidates] of usageFields) {
    const key = candidates.find(candidate => own(bucket, candidate));
    if (!key) fail(location, `missing ${canonical}`);
    const value = bucket[key];
    if (canonical.endsWith('Tokens')) nullableNumber(value, `${location}.${canonical}`, true);
    else if (canonical === 'cost') nullableNumber(value, `${location}.${canonical}`);
    else nullableString(value, `${location}.${canonical}`);
    normalized[canonical] = value;
  }
  return normalized;
}

function validateAgents(agents, location) {
  if (!isObject(agents)) fail(location, 'expected an object');
  const normalized = { ...agents };
  for (const key of ['spawned', 'completed', 'failed', 'maxConcurrent']) {
    normalized[key] = requiredNumber(requireKey(agents, key, location), `${location}.${key}`, true);
  }

  const items = requireKey(agents, 'items', location);
  if (items !== null && !Array.isArray(items)) fail(`${location}.items`, 'expected an array or null');
  normalized.items = items === null ? null : items.map((item, index) => {
    const itemLocation = `${location}.items[${index}]`;
    if (!isObject(item)) fail(itemLocation, 'expected an object');
    const normalizedItem = { ...item };
    normalizedItem.role = nullableString(requireKey(item, 'role', itemLocation), `${itemLocation}.role`);
    normalizedItem.modelId = nullableString(requireKey(item, 'modelId', itemLocation), `${itemLocation}.modelId`);
    normalizedItem.tokens = nullableNumber(requireKey(item, 'tokens', itemLocation), `${itemLocation}.tokens`, true);
    normalizedItem.durationMs = nullableNumber(
      requireKey(item, 'durationMs', itemLocation),
      `${itemLocation}.durationMs`,
    );
    normalizedItem.status = nullableString(requireKey(item, 'status', itemLocation), `${itemLocation}.status`);
    return normalizedItem;
  });
  if (normalized.completed + normalized.failed > normalized.spawned) fail(location, 'completed + failed must not exceed spawned');
  if (normalized.maxConcurrent > normalized.spawned) fail(`${location}.maxConcurrent`, 'must not exceed spawned');
  if (normalized.items !== null && normalized.items.length !== normalized.spawned) fail(`${location}.items`, 'must list every spawned subagent');
  return normalized;
}

function validateObjectOrNull(value, location) {
  if (value !== null && !isContainer(value)) fail(location, 'expected an object, array, or null');
  return value;
}

/** Validate and normalize one run.json record. Null remains null throughout. */
export function validateRun(input, source = 'run.json') {
  if (!isObject(input)) fail(source, 'expected a JSON object');

  const run = { ...input };
  const schemaVersion = requireKey(input, 'schemaVersion', source);
  if (
    !(
      (typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) && schemaVersion > 0) ||
      (typeof schemaVersion === 'string' && schemaVersion.trim() !== '')
    )
  ) {
    fail(`${source}.schemaVersion`, 'expected a positive integer or non-empty string');
  }

  for (const key of ['runId', 'cohortId', 'taskId']) identifier(requireKey(input, key, source), `${source}.${key}`);
  const runKind = requireKey(input, 'runKind', source);
  if (runKind !== 'official' && runKind !== 'debug') fail(`${source}.runKind`, 'expected official or debug');
  run.runKind = runKind;
  nullableString(requireKey(input, 'status', source), `${source}.status`);
  if (input.status === null || !statuses.has(input.status)) fail(`${source}.status`, `expected one of ${[...statuses].join(', ')}`);
  if (runKind === 'debug' && input.status !== 'inconclusive') {
    fail(`${source}.status`, 'debug runs must be inconclusive');
  }

  const model = requireKey(input, 'model', source);
  if (!isObject(model)) fail(`${source}.model`, 'expected an object');
  run.model = { ...model };
  for (const key of ['displayName', 'provider', 'modelId']) {
    run.model[key] = requiredString(requireKey(model, key, `${source}.model`), `${source}.model.${key}`);
  }
  run.model.revision = nullableString(requireKey(model, 'revision', `${source}.model`), `${source}.model.revision`);
  const reasoning = requireKey(model, 'reasoning', `${source}.model`);
  if (reasoning !== null && typeof reasoning !== 'string' && typeof reasoning !== 'boolean' && !isContainer(reasoning)) {
    fail(`${source}.model.reasoning`, 'expected a string, boolean, object, array, or null');
  }
  run.model.reasoning = reasoning;

  const execution = requireKey(input, 'execution', source);
  if (!isObject(execution)) fail(`${source}.execution`, 'expected an object');
  run.execution = { ...execution };
  const startedAt = dateValue(requireKey(execution, 'startedAt', `${source}.execution`), `${source}.execution.startedAt`);
  const endedAt = dateValue(requireKey(execution, 'endedAt', `${source}.execution`), `${source}.execution.endedAt`);
  if (runKind === 'official' && (startedAt === null || endedAt === null)) {
    fail(`${source}.execution`, 'official runs must record startedAt and endedAt');
  }
  if (startedAt !== null && endedAt !== null && Date.parse(endedAt) < Date.parse(startedAt)) {
    fail(`${source}.execution`, 'endedAt must not be before startedAt');
  }
  run.execution.startedAt = startedAt;
  run.execution.endedAt = endedAt;
  run.execution.timeZone = requiredString(
    requireKey(execution, 'timeZone', `${source}.execution`),
    `${source}.execution.timeZone`,
  );
  run.execution.durationMs = nullableNumber(
    requireKey(execution, 'durationMs', `${source}.execution`),
    `${source}.execution.durationMs`,
  );
  if (runKind === 'official' && run.execution.durationMs === null) {
    fail(`${source}.execution.durationMs`, 'official runs must record durationMs');
  }
  if (startedAt !== null && endedAt !== null && run.execution.durationMs !== null
    && Math.abs(Date.parse(endedAt) - Date.parse(startedAt) - run.execution.durationMs) > 1000) {
    fail(`${source}.execution.durationMs`, 'must match startedAt and endedAt within one second');
  }
  run.execution.agentSteps = nullableNumber(
    requireKey(execution, 'agentSteps', `${source}.execution`),
    `${source}.execution.agentSteps`,
    true,
  );
  run.execution.toolCalls = nullableNumber(
    requireKey(execution, 'toolCalls', `${source}.execution`),
    `${source}.execution.toolCalls`,
    true,
  );
  run.execution.terminationReason = requiredString(
    requireKey(execution, 'terminationReason', `${source}.execution`),
    `${source}.execution.terminationReason`,
  );
  const lane = requireKey(execution, 'lane', `${source}.execution`);
  if (lane !== 'autonomous' && lane !== 'assisted') fail(`${source}.execution.lane`, 'expected autonomous or assisted');
  run.execution.lane = lane;
  run.execution.harness = requiredString(
    requireKey(execution, 'harness', `${source}.execution`),
    `${source}.execution.harness`,
  );
  const isolation = requireKey(execution, 'isolation', `${source}.execution`);
  if (!['isolated-candidate-workspace', 'tools-disabled-api', 'same-host-debug'].includes(isolation)) {
    fail(`${source}.execution.isolation`, 'expected isolated-candidate-workspace, tools-disabled-api, or same-host-debug');
  }
  if (runKind === 'official' && isolation === 'same-host-debug') {
    fail(`${source}.execution.isolation`, 'official runs require an isolated execution lane');
  }
  run.execution.isolation = isolation;

  const usage = requireKey(input, 'usage', source);
  if (!isObject(usage)) fail(`${source}.usage`, 'expected an object');
  run.usage = { ...usage };
  for (const key of ['root', 'subagents', 'total']) {
    run.usage[key] = validateUsageBucket(
      requireKey(usage, key, `${source}.usage`),
      `${source}.usage.${key}`,
    );
  }
  for (const key of ['inputTokens', 'outputTokens', 'cachedTokens', 'reasoningTokens', 'totalTokens', 'cost']) {
    const [rootValue, subagentValue, totalValue] = [run.usage.root[key], run.usage.subagents[key], run.usage.total[key]];
    if (rootValue !== null && subagentValue !== null && totalValue !== null
      && Math.abs(rootValue + subagentValue - totalValue) > 1e-9) {
      fail(`${source}.usage.total.${key}`, 'must equal root + subagents without double counting');
    }
  }

  run.agents = validateAgents(requireKey(input, 'agents', source), `${source}.agents`);
  const interventionKey = own(input, 'interventions') ? 'interventions' : own(input, 'intervention') ? 'intervention' : null;
  if (!interventionKey) fail(source, 'missing interventions');
  const interventions = requireKey(input, interventionKey, source);
  if (!Array.isArray(interventions)) fail(`${source}.${interventionKey}`, 'expected an array');
  delete run.intervention;
  run.interventions = interventions;
  run.artifacts = validateArtifacts(input.artifacts, `${source}.artifacts`);
  for (const key of ['versions', 'hashes', 'evaluation']) {
    validateObjectOrNull(requireKey(input, key, source), `${source}.${key}`);
  }

  return run;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalize(value[key])]),
  );
}

async function readJson(file) {
  let content;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`${file}: cannot read run.json (${error.message})`);
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${file}: invalid JSON (${error.message})`);
  }
}

async function rejectSymlinks(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) fail(file, 'symlinks are not allowed');
    if (stat.isDirectory()) await rejectSymlinks(file);
  }
}

/** Read each direct run directory, reject duplicates, and return sorted records. */
async function readRunEntries(runsDir) {
  const root = path.resolve(runsDir);
  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) fail(root, 'runs directory does not exist');

  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const runs = [];
  const seen = new Set();
  for (const entry of entries) {
    if (entry.isSymbolicLink()) fail(path.join(root, entry.name), 'path traversal and symlinks are not allowed');
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_')) continue;
    if (entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('\0')) {
      fail(path.join(root, entry.name), 'path traversal and symlinks are not allowed');
    }
    const runFile = path.join(root, entry.name, 'run.json');
    const runStat = await lstat(runFile).catch(() => null);
    if (!runStat || !runStat.isFile() || runStat.isSymbolicLink()) fail(runFile, 'run.json file is required');
    await rejectSymlinks(path.join(root, entry.name));
    const run = validateRun(await readJson(runFile), `${entry.name}/run.json`);
    if (seen.has(run.runId)) fail(`${entry.name}/run.json.runId`, `duplicate runId: ${run.runId}`);
    seen.add(run.runId);
    runs.push({ run, sourceDir: path.join(root, entry.name) });
  }
  return runs.sort((a, b) => a.run.runId < b.run.runId ? -1 : a.run.runId > b.run.runId ? 1 : 0);
}

export async function loadRuns(runsDir) {
  return (await readRunEntries(runsDir)).map(({ run }) => run);
}

async function copyDirectory(source, target) {
  const sourceStat = await lstat(source).catch(() => null);
  if (!sourceStat || !sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    fail(source, 'web directory does not exist');
  }
  await mkdir(target, { recursive: true });
  const entries = (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) fail(from, 'symlinks are not allowed in web assets');
    if (entry.isDirectory()) await copyDirectory(from, to);
    else if (entry.isFile()) await cp(from, to);
    else fail(from, 'unsupported web asset');
  }
}

async function copyRunArtifacts(entries, distDir) {
  for (const { run, sourceDir } of entries) {
    if (run.artifacts === null) continue;
    for (const artifact of run.artifacts) {
      const segments = artifact.path.split('/');
      const source = path.resolve(sourceDir, ...segments);
      const relative = path.relative(sourceDir, source);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        fail(`${run.runId}.artifacts.${artifact.path}`, 'artifact must stay inside its run directory');
      }
      const sourceStat = await lstat(source).catch(() => null);
      if (!sourceStat || !sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        fail(`${run.runId}.artifacts.${artifact.path}`, 'artifact file does not exist or is a symlink');
      }
      const destination = path.join(distDir, 'artifacts', encodeURIComponent(run.runId), ...segments);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination);
      artifact.url = `./artifacts/${encodeURIComponent(run.runId)}/${segments.map(encodeURIComponent).join('/')}`;
    }
  }
}

async function validateArtifactFiles(entries) {
  for (const { run, sourceDir } of entries) {
    if (run.artifacts === null) continue;
    for (const artifact of run.artifacts) {
      const source = path.resolve(sourceDir, ...artifact.path.split('/'));
      const relative = path.relative(sourceDir, source);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        fail(`${run.runId}.artifacts.${artifact.path}`, 'artifact must stay inside its run directory');
      }
      const sourceStat = await lstat(source).catch(() => null);
      if (!sourceStat || !sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        fail(`${run.runId}.artifacts.${artifact.path}`, 'artifact file does not exist or is a symlink');
      }
    }
  }
}

async function copyPrompts(source, target) {
  const sourceStat = await lstat(source).catch(() => null);
  if (!sourceStat) fail(source, 'prompts directory does not exist');
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) fail(source, 'prompts directory is invalid');
  await mkdir(target, { recursive: true });
  const entries = (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith('.md')) continue;
    const from = path.join(source, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile()) fail(from, 'prompt assets must be regular files');
    await cp(from, path.join(target, entry.name));
  }
  for (const taskId of benchmarkTaskIds) {
    const payload = await buildPromptPayload(taskId, source);
    const promptText = formatPromptText(payload);
    const escaped = promptText.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
    await writeFile(path.join(target, `${taskId}.prompt.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await writeFile(path.join(target, `${taskId}.prompt.txt`), promptText, 'utf8');
    await writeFile(path.join(target, `${taskId}.prompt.html`), `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${taskId} prompt</title><style>body{max-width:72rem;margin:auto;padding:2rem;background:#101225;color:#f5f7ff;font:16px/1.65 system-ui}a{color:#71e7ff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#191c38;border:1px solid #3d4472;border-radius:1rem;padding:1.25rem}</style>
<p><a href="../">← 結果一覧</a> · <a href="./${taskId}.prompt.txt" download>テキストを保存</a></p><h1>${taskId}</h1><pre>${escaped}</pre></html>
`, 'utf8');
  }
}

function isSameOrInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function overlaps(first, second) {
  return isSameOrInside(first, second) || isSameOrInside(second, first);
}

function parseCli(args) {
  const values = {};
  const positional = [];
  const names = new Map([
    ['--runs', 'runsDir'],
    ['--runs-dir', 'runsDir'],
    ['--web', 'webDir'],
    ['--web-dir', 'webDir'],
    ['--dist', 'distDir'],
    ['--dist-dir', 'distDir'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const name = names.get(args[index]);
    if (!name) {
      if (args[index].startsWith('-')) throw new Error(`Unknown option: ${args[index]}`);
      positional.push(args[index]);
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith('-')) throw new Error(`${args[index - 1]} requires a path`);
    values[name] = value;
  }
  if (positional[0] !== undefined) values.runsDir = positional[0];
  if (positional[1] !== undefined) values.distDir = positional[1];
  if (positional[2] !== undefined) values.webDir = positional[2];
  return values;
}

/** Build the static site and deterministic data/runs.json. */
export async function buildSite(options = {}) {
  const root = path.resolve(options.rootDir ?? projectRoot);
  const runsDir = path.resolve(options.runsDir ?? path.join(root, 'runs'));
  const webDir = path.resolve(options.webDir ?? path.join(root, 'web'));
  const promptsDir = path.resolve(options.promptsDir ?? path.join(root, 'prompts'));
  const distDir = path.resolve(options.distDir ?? path.join(root, 'dist'));
  if (distDir === root || !isSameOrInside(root, distDir)) {
    fail(distDir, 'dist directory must be a child of the project root');
  }
  if ([runsDir, webDir, promptsDir].some(source => overlaps(distDir, source))) {
    fail(distDir, 'dist directory must not overlap runs, web, or prompts');
  }

  // Validate everything before deleting generated output.
  const runEntries = await readRunEntries(runsDir);
  const runs = runEntries.map(({ run }) => run);
  await validateArtifactFiles(runEntries);
  await lstat(webDir).then(stat => {
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(webDir, 'web directory does not exist');
  }).catch(error => {
    if (error.message.startsWith(`${webDir}:`)) throw error;
    fail(webDir, 'web directory does not exist');
  });
  const existingDist = await lstat(distDir).catch(() => null);
  if (existingDist?.isSymbolicLink()) fail(distDir, 'dist directory must not be a symlink');

  await rm(distDir, { recursive: true, force: true });
  await copyDirectory(webDir, distDir);
  await copyPrompts(promptsDir, path.join(distDir, 'prompts'));
  await copyRunArtifacts(runEntries, distDir);
  const dataDir = path.join(distDir, 'data');
  const outputFile = path.join(dataDir, 'runs.json');
  await mkdir(dataDir, { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(canonicalize(runs), null, 2)}\n`, 'utf8');
  return { count: runs.length, outputFile, runs };
}

const invokedFile = process.argv[1] && path.resolve(process.argv[1]);
if (invokedFile === scriptFile) {
  buildSite(parseCli(process.argv.slice(2)))
    .then(result => {
      const shown = path.relative(process.cwd(), result.outputFile) || path.basename(result.outputFile);
      console.log(`Built ${result.count} run(s) -> ${shown}`);
    })
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
