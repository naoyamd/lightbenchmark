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
const showcaseExtensions = new Set(['.html', '.css', '.js', '.mjs', '.json']);
const liveShowcaseLimit = 2 * 1024 * 1024;
const chatShowcaseLimit = 64 * 1024;

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
    /^[A-Za-z]:/.test(normalized) ||
    /^[A-Za-z][A-Za-z+.-]*:\/\//.test(normalized) ||
    normalized.includes('\0') ||
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

function validateAgents(agents, location, allowIncomplete = false) {
  if (!isObject(agents)) fail(location, 'expected an object');
  const normalized = { ...agents };
  normalized.spawned = requiredNumber(requireKey(agents, 'spawned', location), `${location}.spawned`, true);
  for (const key of ['completed', 'failed', 'maxConcurrent']) {
    const value = requireKey(agents, key, location);
    normalized[key] = allowIncomplete
      ? nullableNumber(value, `${location}.${key}`, true)
      : requiredNumber(value, `${location}.${key}`, true);
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
  if (normalized.completed !== null && normalized.failed !== null
    && normalized.completed + normalized.failed > normalized.spawned) {
    fail(location, 'completed + failed must not exceed spawned');
  }
  if (normalized.maxConcurrent !== null && normalized.maxConcurrent > normalized.spawned) {
    fail(`${location}.maxConcurrent`, 'must not exceed spawned');
  }
  if (normalized.items !== null && normalized.items.length !== normalized.spawned) fail(`${location}.items`, 'must list every spawned subagent');
  return normalized;
}

function validateShowcase(value, location) {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) fail(location, 'expected an object or null');
  const kind = own(value, 'kind') ? value.kind : own(value, 'type') ? value.type : value.mode;
  if (kind !== 'live' && kind !== 'chat') fail(`${location}.kind`, 'expected live or chat');
  const normalized = { ...value, kind };
  if (kind === 'live') {
    normalized.entry = relativeAssetPath(requireKey(value, 'entry', location), `${location}.entry`);
    if (path.extname(normalized.entry).toLowerCase() !== '.html') {
      fail(`${location}.entry`, 'live entry must be an HTML file');
    }
    normalized.protocol = own(value, 'protocol') ? requiredString(value.protocol, `${location}.protocol`) : 'LIGHTBENCH-1';
    if (normalized.protocol !== 'LIGHTBENCH-1') fail(`${location}.protocol`, 'expected LIGHTBENCH-1');
    normalized.scenario = own(value, 'scenario') ? requiredString(value.scenario, `${location}.scenario`) : 'public-v1';
    if (normalized.scenario !== 'public-v1') fail(`${location}.scenario`, 'expected public-v1');
    for (const key of ['bundle', 'root', 'directory']) {
      if (own(value, key)) normalized[key] = relativeAssetPath(value[key], `${location}.${key}`);
    }
    if (own(value, 'path')) normalized.path = relativeAssetPath(value.path, `${location}.path`);
  } else {
    if (own(value, 'turns')) {
      if (!Array.isArray(value.turns) || value.turns.length === 0) fail(`${location}.turns`, 'expected a non-empty array');
      normalized.turns = value.turns.map((turn, index) => {
        const turnLocation = `${location}.turns[${index}]`;
        if (!isObject(turn)) fail(turnLocation, 'expected an object');
        const item = { ...turn };
        item.label = requiredString(requireKey(turn, 'label', turnLocation), `${turnLocation}.label`);
        item.path = relativeAssetPath(requireKey(turn, 'path', turnLocation), `${turnLocation}.path`);
        if (path.extname(item.path).toLowerCase() !== '.txt') fail(`${turnLocation}.path`, 'chat showcase must be a .txt file');
        return item;
      });
    } else {
      // Keep accepting the original single-transcript form while normalizing it to turns.
      const fileKey = own(value, 'path') ? 'path' : own(value, 'file') ? 'file' : own(value, 'transcript') ? 'transcript' : null;
      if (!fileKey) fail(`${location}.turns`, 'chat showcase requires turns');
      const transcript = relativeAssetPath(value[fileKey], `${location}.${fileKey}`);
      if (path.extname(transcript).toLowerCase() !== '.txt') fail(`${location}.${fileKey}`, 'chat showcase must be a .txt file');
      normalized.turns = [{ label: 'チャット', path: transcript }];
    }
  }
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

  run.agents = validateAgents(requireKey(input, 'agents', source), `${source}.agents`, runKind === 'debug');
  const interventionKey = own(input, 'interventions') ? 'interventions' : own(input, 'intervention') ? 'intervention' : null;
  if (!interventionKey) fail(source, 'missing interventions');
  const interventions = requireKey(input, interventionKey, source);
  if (!Array.isArray(interventions)) fail(`${source}.${interventionKey}`, 'expected an array');
  delete run.intervention;
  run.interventions = interventions;
  run.artifacts = validateArtifacts(input.artifacts, `${source}.artifacts`);
  run.showcase = validateShowcase(input.showcase, `${source}.showcase`);
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

function decodeUtf8(bytes, location) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(location, 'showcase file must be valid UTF-8');
  }
}

function insideDirectory(parent, relative, location) {
  const source = path.resolve(parent, ...relative.split('/'));
  const actual = path.relative(parent, source);
  if (!actual || actual.startsWith('..') || path.isAbsolute(actual)) {
    fail(location, 'showcase path must stay inside its run directory');
  }
  return source;
}

function showcaseKind(showcase) {
  return showcase?.kind ?? showcase?.type ?? showcase?.mode;
}

function hasForbiddenLiveMarkup(html) {
  if (/<base\b[^>]*>/i.test(html)) return '<base> is not allowed';
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  if (metas.some(meta => /\bhttp-equiv\s*=\s*["']?content-security-policy\b/i.test(meta))) {
    return 'an existing Content-Security-Policy is not allowed';
  }
  return null;
}

function bridgeScript(taskId) {
  const safeTaskId = JSON.stringify(taskId).replace(/</g, '\\u003c');
  return `(function () {
  const taskId = ${safeTaskId};
  const actions = {
    'color-cascade-18': ['reset', 'runChallenge'],
    'prism-twist': ['reset', 'scramble', 'play'],
    'lander-pop': ['reset', 'run']
  }[taskId] || [];
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') || Math.random().toString(36).slice(2);
  const send = message => window.parent.postMessage({ protocol: 'LIGHTBENCH-1', nonce, taskId, ...message }, '*');
  window.addEventListener('message', async event => {
    const data = event.data;
    if (event.source !== window.parent || !data || data.protocol !== 'LIGHTBENCH-1' || data.nonce !== nonce || data.taskId !== taskId) return;
    if (data.type !== 'command') return;
    const requestId = data.requestId;
    if (!actions.includes(data.action)) {
      send({ type: 'response', requestId, ok: false, error: 'unsupported action' });
      return;
    }
    try {
      const api = window.__LIGHTBENCH__;
      if (!api || typeof api[data.action] !== 'function') throw new Error('showcase API is unavailable');
      const args = Array.isArray(data.args) ? data.args : [];
      const value = await api[data.action](...args);
      send({ type: 'response', requestId, ok: true, value });
    } catch (error) {
      send({ type: 'response', requestId, ok: false, error: String(error?.message || error) });
    }
  });
  window.addEventListener('load', () => {
    const deadline = Date.now() + 7500;
    const announce = () => {
      const api = window.__LIGHTBENCH__;
      if (api && actions.every(action => typeof api[action] === 'function')) {
        send({ type: 'ready', actions });
      } else if (Date.now() < deadline) {
        setTimeout(announce, 50);
      }
    };
    announce();
  });
}());`;
}

function injectLiveHtml(html, taskId = null) {
  const forbidden = hasForbiddenLiveMarkup(html);
  if (forbidden) fail('showcase.entry', forbidden);
  const assetRoot = '__LIGHTBENCH_ASSET_ROOT_9b41c8__';
  const csp = `<meta data-lightbenchmark-csp http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${assetRoot}; style-src 'unsafe-inline' ${assetRoot}; img-src ${assetRoot} data: blob:; media-src ${assetRoot} data: blob:; font-src ${assetRoot} data:; connect-src ${assetRoot}; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri ${assetRoot}; form-action 'none'">`;
  const base = `<base data-lightbenchmark-base href="${assetRoot}">`;
  const bridge = taskId ? `<script>${bridgeScript(taskId)}</script>` : '';
  const prefix = `${csp}${base}${bridge}`;
  return /^\s*<!doctype\b[^>]*>/i.test(html)
    ? html.replace(/^(\s*<!doctype\b[^>]*>)/i, `$1${prefix}`)
    : `${prefix}${html}`;
}

async function collectLiveFiles(sourceRoot, sourceDir, run, entry) {
  const artifactPaths = new Set((run.artifacts ?? []).map(artifact => artifact.path));
  const sourcePrefix = path.relative(sourceDir, sourceRoot).replace(/\\/g, '/');
  const files = [];
  let totalBytes = 0;
  async function visit(directory, relative = '') {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const item of entries) {
      const itemRelative = relative ? `${relative}/${item.name}` : item.name;
      const file = path.join(directory, item.name);
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) fail(file, 'showcase symlinks are not allowed');
      if (stat.isDirectory()) {
        await visit(file, itemRelative);
        continue;
      }
      if (!stat.isFile()) fail(file, 'showcase assets must be regular files');
      // run.json and declared artifact files belong to the run, not its live bundle.
      const runRelative = sourcePrefix ? `${sourcePrefix}/${itemRelative}` : itemRelative;
      if ((!sourcePrefix && itemRelative === 'run.json') || artifactPaths.has(runRelative)) continue;
      const extension = path.extname(itemRelative).toLowerCase();
      if (!showcaseExtensions.has(extension)) fail(file, 'live showcase files must be UTF-8 .html, .css, .js, .mjs, or .json');
      const bytes = await readFile(file);
      decodeUtf8(bytes, file);
      totalBytes += bytes.byteLength;
      if (totalBytes > liveShowcaseLimit) fail(sourceDir, 'live showcase bundle exceeds 2 MiB');
      files.push({ relative: itemRelative, bytes });
    }
  }
  await visit(sourceRoot);
  const entryFile = files.find(file => file.relative === entry);
  if (!entryFile) fail(`${run.runId}.showcase.entry`, 'live entry file does not exist');
  for (const file of files.filter(item => path.extname(item.relative).toLowerCase() === '.html')) {
    const originalBytes = file.bytes.byteLength;
    const html = decodeUtf8(file.bytes, `${run.runId}.showcase.${file.relative}`);
    file.bytes = Buffer.from(injectLiveHtml(html, file === entryFile ? run.taskId : null), 'utf8');
    totalBytes += file.bytes.byteLength - originalBytes;
  }
  if (totalBytes > liveShowcaseLimit) fail(sourceDir, 'published live showcase bundle exceeds 2 MiB');
  return files;
}

async function prepareShowcases(entries) {
  const prepared = [];
  for (const { run, sourceDir } of entries) {
    const showcase = run.showcase;
    if (!showcase) continue;
    const kind = showcaseKind(showcase);
    if (kind === 'chat') {
      const seen = new Set();
      const preparedTurns = await Promise.all(showcase.turns.map(async (turn, index) => {
        const location = `${run.runId}.showcase.turns[${index}]`;
        if (seen.has(turn.path)) fail(`${location}.path`, `duplicate chat transcript path: ${turn.path}`);
        seen.add(turn.path);
        const source = insideDirectory(sourceDir, turn.path, location);
        const stat = await lstat(source).catch(() => null);
        if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail(location, 'chat transcript file does not exist or is a symlink');
        const bytes = await readFile(source);
        if (bytes.byteLength > chatShowcaseLimit) fail(location, 'chat transcript exceeds 64 KiB');
        const text = decodeUtf8(bytes, source);
        return { turn: { ...turn, text }, file: { relative: turn.path, bytes } };
      }));
      run.showcase.turns = preparedTurns.map(item => item.turn);
      prepared.push({ run, files: preparedTurns.map(item => item.file) });
      continue;
    }
    const bundleKey = ['bundle', 'root', 'directory', 'path'].find(key => own(showcase, key));
    const bundlePath = bundleKey ? showcase[bundleKey] : '';
    const sourceRoot = bundlePath ? insideDirectory(sourceDir, bundlePath, `${run.runId}.showcase.${bundleKey}`) : sourceDir;
    const rootStat = await lstat(sourceRoot).catch(() => null);
    if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      fail(`${run.runId}.showcase.${bundleKey ?? 'entry'}`, 'live showcase bundle directory does not exist or is a symlink');
    }
    const files = await collectLiveFiles(sourceRoot, sourceDir, run, showcase.entry);
    const prefix = bundlePath ? `${bundlePath}/` : '';
    prepared.push({
      run,
      files: files.map(file => ({ relative: `${prefix}${file.relative}`, bytes: file.bytes })),
      entry: `${prefix}${showcase.entry}`,
    });
  }
  return prepared;
}

async function copyShowcases(prepared, distDir) {
  for (const item of prepared) {
    const root = path.join(distDir, 'showcases', encodeURIComponent(item.run.runId));
    for (const file of item.files) {
      const destination = path.join(root, ...file.relative.split('/'));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.bytes);
    }
    if (item.entry) {
      const relative = item.entry;
      item.run.showcase.url = `./showcases/${encodeURIComponent(item.run.runId)}/${relative.split('/').map(encodeURIComponent).join('/')}`;
    } else {
      item.run.showcase.urls = item.files.map(file => `./showcases/${encodeURIComponent(item.run.runId)}/${file.relative.split('/').map(encodeURIComponent).join('/')}`);
    }
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

function modelSlug(modelId) {
  const slug = modelId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) fail(`model.${modelId}`, 'modelId cannot produce an empty page path');
  return slug;
}

function htmlText(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

async function writeModelPages(runs, distDir) {
  const shell = await readFile(path.join(distDir, 'index.html'), 'utf8');
  const models = new Map();
  for (const run of runs) {
    if (run.demo === true || run.isDemo === true) continue;
    const id = run.model.modelId;
    const slug = modelSlug(id);
    if (models.has(slug) && models.get(slug).modelId !== id) fail(`model.${id}`, `page path conflicts with ${models.get(slug).modelId}`);
    models.set(slug, run.model);
    run.model.pageUrl = `./models/${slug}/`;
  }
  for (const [slug, model] of models) {
    const page = shell
      .replace('<head>', '<head>\n    <base href="../../">')
      .replace(/<title>[^<]*<\/title>/, `<title>${htmlText(model.displayName)} | LightBenchmark</title>`)
      .replace('<body>', `<body data-model-id="${htmlText(model.modelId)}">`);
    const target = path.join(distDir, 'models', slug);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'index.html'), page, 'utf8');
  }
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
  const preparedShowcases = await prepareShowcases(runEntries);
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
  await copyShowcases(preparedShowcases, distDir);
  await writeModelPages(runs, distDir);
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
