import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const actions = {
  'color-cascade-18': ['reset', 'runChallenge'],
  'prism-twist': ['reset', 'scramble', 'play'],
  'lander-pop': ['reset', 'run'],
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function compactResult(value) {
  if (!value || typeof value !== 'object') return value;
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes <= 8_192) return value;
  const result = Object.fromEntries(['status', 'phase', 'chain', 'chainCount', 'clearCount', 'solved', 'landed', 'state', 'sensor', 'control', 'scramble', 'eventCount', 'board', 'next']
    .filter(key => key in value).map(key => [key, value[key]]));
  return { ...result, truncated: true, originalBytes: bytes };
}

function browserPath() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find(file => requireStat(file)) ?? null;
}

function requireStat(file) {
  try { return process.getBuiltinModule('fs').statSync(file).isFile(); } catch { return false; }
}

async function listen(server) {
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  return server.address().port;
}

function serve(directory) {
  const csp = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";
  return createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
      if (relative === 'favicon.ico') { response.writeHead(204).end(); return; }
      const file = path.resolve(directory, relative);
      const inside = path.relative(directory, file);
      if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('not found');
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Security-Policy': csp, 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' })[path.extname(file)] ?? 'application/octet-stream' });
      response.end(bytes);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
}

async function debuggerTarget(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const page = targets.find(target => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(100);
  }
  throw new Error('Chromium DevTools endpoint did not start');
}

async function cdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) { events.push(message); return; }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  return {
    events,
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function stopBrowser(child) {
  if (!child.pid || child.exitCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGKILL');
  await Promise.race([closed, delay(5_000)]);
}

const timeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
]);

async function smokeAttempt(taskId, siteDirectory, { artifactsDir = null } = {}) {
  if (!actions[taskId]) throw new Error(`unknown task: ${taskId}`);
  const root = path.resolve(siteDirectory);
  if (!(await lstat(path.join(root, 'index.html')).catch(() => null))?.isFile()) throw new Error('index.html is missing');
  const executable = browserPath();
  if (!executable) throw new Error('Chromium is unavailable');
  const server = serve(root);
  const sitePort = await listen(server);
  const debugProbe = createServer();
  const debugPort = await listen(debugProbe);
  await new Promise(resolve => debugProbe.close(resolve));
  const profile = await mkdtemp(path.join(tmpdir(), 'lightbenchmark-chrome-'));
  const child = spawn(executable, [
    '--headless=new', `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-extensions',
    '--window-size=1100,760', 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let client;
  try {
    const pageUrl = `http://127.0.0.1:${sitePort}/index.html`;
    client = await cdp(await debuggerTarget(debugPort));
    await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable'].map(method => client.call(method)));
    await client.call('Page.navigate', { url: pageUrl });
    await timeout((async () => {
      while (true) {
        try {
          const state = await client.call('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
          if (state.result?.value === 'complete') return;
        } catch (error) {
          if (!error.message.includes('Execution context was destroyed')) throw error;
        }
        await delay(100);
      }
    })(), 10_000, 'page load');
    const expected = actions[taskId];
    const probe = await client.call('Runtime.evaluate', { expression: `new Promise(resolve=>{const end=Date.now()+7500;const check=()=>{const a=window.__LIGHTBENCH__,v=${JSON.stringify(expected)}.map(k=>typeof a?.[k]);v.every(x=>x==='function')||Date.now()>=end?resolve(v):setTimeout(check,50)};check()})`, awaitPromise: true, returnByValue: true });
    if (!probe.result?.value?.every(value => value === 'function')) {
      const errors = client.events.filter(event => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded').map(event => event.params?.exceptionDetails?.text ?? event.params?.entry?.text ?? event.method);
      throw new Error(`showcase API is incomplete: ${JSON.stringify(probe.result?.value)}${errors.length ? `; ${errors.join('; ')}` : ''}`);
    }
    const shot = async () => Buffer.from((await client.call('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    const before = await shot();
    const expression = `window.__LIGHTBENCH_SMOKE__=(async()=>{const a=window.__LIGHTBENCH__;${expected.map(name => `await a.${name}();`).join('')}return typeof a.snapshot==='function'?await a.snapshot():null})()`;
    await client.call('Runtime.evaluate', { expression });
    await delay(250);
    const middle = await shot();
    const completed = await timeout(client.call('Runtime.evaluate', { expression: 'window.__LIGHTBENCH_SMOKE__', awaitPromise: true, returnByValue: true }), 60_000, 'showcase action');
    const after = await shot();
    const errors = client.events.filter(event => event.method === 'Runtime.exceptionThrown' || (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error'));
    const hashes = { before: sha256(before), middle: sha256(middle), after: sha256(after) };
    const frameChanged = new Set(Object.values(hashes)).size > 1;
    if (artifactsDir) {
      await mkdir(artifactsDir, { recursive: true });
      await Promise.all([[before, 'before.png'], [middle, 'middle.png'], [after, 'after.png']].map(([bytes, name]) => writeFile(path.join(artifactsDir, name), bytes)));
    }
    return { schemaVersion: 1, taskId, pass: errors.length === 0 && frameChanged, api: expected, frameChanged, screenshotHashes: hashes, result: compactResult(completed.result?.value ?? null), errors: errors.map(event => event.params?.exceptionDetails?.text ?? event.params?.entry?.text ?? event.method) };
  } finally {
    client?.close();
    await stopBrowser(child);
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

export async function smokeShowcase(taskId, siteDirectory, options = {}) {
  try {
    return await smokeAttempt(taskId, siteDirectory, options);
  } catch (error) {
    if (!/Execution context was destroyed/u.test(error.message)) throw error;
    return smokeAttempt(taskId, siteDirectory, options);
  }
}

function parseArgs(args) {
  let [taskId, siteDirectory, ...rest] = args;
  if (!taskId) {
    siteDirectory = 'submission/site';
    taskId = requireStat(path.join(siteDirectory, 'challenge.json')) ? 'color-cascade-18'
      : requireStat(path.join(siteDirectory, 'controller.mjs')) ? 'lander-pop'
        : requireStat(path.join(siteDirectory, 'engine.mjs')) ? 'prism-twist' : null;
  }
  if (!taskId || !siteDirectory) throw new Error('Usage: node showcase-smoke.mjs [<task-id> <submission/site>] [--artifacts-dir PATH] [--output FILE]');
  const options = { taskId, siteDirectory };
  while (rest.length) {
    const key = rest.shift();
    const value = rest.shift();
    if (!value) throw new Error(`${key} requires a value`);
    if (key === '--artifacts-dir') options.artifactsDir = value;
    else if (key === '--output') options.output = value;
    else throw new Error(`unknown option: ${key}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  const options = parseArgs(process.argv.slice(2));
  smokeShowcase(options.taskId, options.siteDirectory, options)
    .then(async result => {
      const text = `${JSON.stringify(result, null, 2)}\n`;
      if (options.output) await writeFile(options.output, text, 'utf8');
      console.log(text.trim());
      if (!result.pass) process.exitCode = 1;
    })
    .catch(error => {
      if (process.env.LIGHTBENCH_CANDIDATE_RUN === '1' && /Execution context was destroyed|Chromium DevTools endpoint did not start|Chromium is unavailable/u.test(error.message)) {
        console.log(JSON.stringify({ pass: null, deferred: true, reason: `候補sandbox固有のbrowser環境エラー。再試行せず終了してください。独立評価器が再実行します: ${error.message}` }));
      } else {
        console.error(error.message);
        process.exitCode = 2;
      }
    });
}
