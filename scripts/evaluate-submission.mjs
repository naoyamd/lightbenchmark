import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cubeOracle from "../evaluator/cube.mjs";
import * as puyoOracle from "../evaluator/puyo.mjs";
import * as rocketOracle from "../evaluator/rocket.mjs";

const scriptFile = fileURLToPath(import.meta.url);
const candidateWorkerFile = fileURLToPath(new URL("./candidate-worker.mjs", import.meta.url));
const TASKS = new Set(["color-cascade-18", "prism-twist", "lander-pop"]);
const CANDIDATE_TIMEOUT_MS = 30_000;

const defaultFixtures = {
  "color-cascade-18": {
    boards: [
      [
        [1, 1, 1, 1, 2, 2],
        [0, 0, 0, 0, 2, 2],
        ...Array.from({ length: 12 }, () => Array(6).fill(0)),
      ],
    ],
    pairs: [
      { board: Array.from({ length: 14 }, () => Array(6).fill(0)), pair: { x: 2, rotation: 0, colors: [1, 2] } },
      { board: Array.from({ length: 14 }, () => Array(6).fill(0)), pair: { x: 5, rotation: 1, colors: [1, 2] } },
    ],
  },
  "prism-twist": {
    seeds: [
      { seed: 0, length: 25 },
      { seed: 0x00c0ffee, length: 25 },
      { seed: 0x12345678, length: 31 },
    ],
    algorithms: [
      ["R", "U", "R'", "U'"],
      ["F2", "D", "L'", "B", "U2", "R"],
    ],
  },
  "lander-pop": {
    scenarios: [
      { seed: 0x5eed1234, overrides: {} },
      { seed: 0x12345678, overrides: { g: 9.4 } },
      { seed: 0x9abcdef0, overrides: { aMax: 20.5 } },
      { seed: 0x10203040, overrides: { windAmp: 0.4, gustAmp: 0.2, padX: -10 } },
      { seed: 0xdeadbeef, overrides: { g: 10.2, aMax: 20.5, fuel0: 0.55 } },
      { seed: 0xcafebabe, overrides: { g: 9.4, aMax: 23.5, windAmp: 0.4, padX: 10, padHalf: 5.5, fuel0: 0.75 } },
      { seed: 0x0badf00d, overrides: { dragCoeff: 0.01, gustAmp: 0.2 } },
      { seed: 0xffffffff, overrides: { g: 10.2, dragCoeff: 0.01, padX: -8 } },
    ],
  },
};

function clone(value) {
  return structuredClone(value);
}

const encodeRpc = (value) => {
  if (value instanceof Uint8Array) return { __lightbenchType: "Uint8Array", data: [...value] };
  if (Array.isArray(value)) return value.map(encodeRpc);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeRpc(item)]));
  }
  return value;
};

const decodeRpc = (value) => {
  if (value?.__lightbenchType === "Uint8Array") return Uint8Array.from(value.data);
  if (Array.isArray(value)) return value.map(decodeRpc);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeRpc(item)]));
  }
  return value;
};

async function rejectCandidateSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error(`candidate symlinks are not allowed: ${file}`);
    if (info.isDirectory()) await rejectCandidateSymlinks(file);
  }
}

async function controllerImportsSimulation(directory) {
  const source = await readFile(path.join(path.resolve(directory), "controller.mjs"), "utf8");
  const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/gu);
  for (const match of imports) {
    const file = match[1].replaceAll("\\", "/").split("/").at(-1).split(/[?#]/u)[0];
    if (/^(?:sim|rocket)(?:\.[a-z0-9]+)?$/iu.test(file)) return true;
  }
  return false;
}

async function startCandidateClient(mode, directory) {
  const root = path.resolve(directory);
  const info = await lstat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`candidate directory does not exist: ${root}`);
  await rejectCandidateSymlinks(root);

  const child = spawn(process.execPath, [
    "--permission",
    `--allow-fs-read=${root}`,
    `--allow-fs-read=${candidateWorkerFile}`,
    "--no-addons",
    "--max-old-space-size=128",
    candidateWorkerFile,
    mode,
    root,
  ], {
    cwd: root,
    env: { NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const pending = new Map();
  const deadline = Date.now() + CANDIDATE_TIMEOUT_MS;
  let buffer = "";
  let stderr = "";
  let exportsByTarget;
  let closed = false;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  let exitResolve;
  const exited = new Promise(resolve => { exitResolve = resolve; });

  const failAll = (error) => {
    if (closed) return;
    closed = true;
    readyReject(error);
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr = `${stderr}${chunk}`.slice(-65_536); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buffer += chunk;
    if (buffer.length > 1_048_576) {
      child.kill();
      failAll(new Error("candidate output exceeded 1 MiB"));
      return;
    }
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message?.type === "ready" && !exportsByTarget) {
        exportsByTarget = message.exports;
        readyResolve();
        continue;
      }
      const request = pending.get(message?.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.ok) request.resolve(decodeRpc(message.result));
      else request.reject(new Error(message.error || "candidate call failed"));
    }
  });
  child.once("error", error => {
    failAll(error);
    exitResolve();
  });
  child.once("close", (code, signal) => {
    failAll(new Error(`candidate process exited (${code ?? signal})${stderr ? `: ${stderr.trim()}` : ""}`));
    exitResolve();
  });

  const readyTimer = setTimeout(() => {
    child.kill();
    failAll(new Error("candidate process did not become ready"));
  }, 5_000);
  await ready.finally(() => clearTimeout(readyTimer));

  const call = (target, method, args) => new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (closed || remaining <= 0) {
      reject(new Error("candidate evaluation timed out"));
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      child.kill();
      reject(new Error(`candidate call timed out: ${method}`));
    }, Math.min(2_000, remaining));
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, target, method, args: encodeRpc(args) })}\n`, error => {
      if (!error) return;
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    });
  });

  const moduleProxy = (target) => {
    const proxy = Object.fromEntries((exportsByTarget?.[target] ?? []).map(method => [
      method,
      method === "createController"
        ? async () => {
          await call(target, method, []);
          return { step: sensor => call(target, "step", [sensor]) };
        }
        : (...args) => call(target, method, args),
    ]));
    if (target === "engine") proxy.__atomicAlgorithmProbe = () => call(target, "__atomicAlgorithmProbe", []);
    return proxy;
  };

  return {
    module: moduleProxy,
    async close() {
      if (!closed) child.kill();
      await exited;
    },
  };
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function same(actual, expected, tolerance = 0) {
  if (typeof actual === "number" && typeof expected === "number") {
    return Number.isFinite(actual) && Number.isFinite(expected)
      && Math.abs(actual - expected) <= tolerance;
  }
  if (actual instanceof Uint8Array || expected instanceof Uint8Array) {
    return actual instanceof Uint8Array && expected instanceof Uint8Array
      && actual.length === expected.length
      && actual.every((value, index) => value === expected[index]);
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected)
      && actual.length === expected.length
      && actual.every((value, index) => same(value, expected[index], tolerance));
  }
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    return same(actualKeys, expectedKeys) && actualKeys.every((key) => same(actual[key], expected[key], tolerance));
  }
  return Object.is(actual, expected);
}

async function check(name, kind, test) {
  try {
    const detail = await test();
    if (detail === false) throw new Error("result did not match the reference");
    return { name, kind, pass: true, ...(typeof detail === "string" ? { detail } : {}) };
  } catch (error) {
    return { name, kind, pass: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function requireFunctions(module, names) {
  for (const name of names) {
    if (typeof module[name] !== "function") throw new Error(`missing export: ${name}`);
  }
}

function summarize(taskId, fixture, checks, extra = {}) {
  const passFor = (kind) => checks.filter((item) => item.kind === kind).every((item) => item.pass);
  const headlinePass = passFor("headline");
  const logicPass = passFor("logic");
  const robustnessPass = passFor("robustness");
  return {
    schemaVersion: 1,
    taskId,
    fixture: { sha256: hash(fixture) },
    checks,
    headlinePass,
    logicPass,
    robustnessPass,
    pass: headlinePass && logicPass && robustnessPass,
    ...extra,
  };
}

function validChallengeBoard(board) {
  if (!Array.isArray(board) || board.length !== 14 || board.some((row) => !Array.isArray(row) || row.length !== 6)) return false;
  if (board.flat().filter(Boolean).length !== 72) return false;
  if (!same([...new Set(board.flat().filter(Boolean))].sort(), [1, 2, 3, 4])) return false;
  if (board.flat().some((cell) => !Number.isInteger(cell) || cell < 0 || cell > 4)) return false;
  for (let x = 0; x < 6; x += 1) {
    let emptySeen = false;
    for (let y = 0; y < 14; y += 1) {
      if (board[y][x] === 0) emptySeen = true;
      else if (emptySeen) return false;
    }
  }
  return true;
}

export async function evaluatePuyoModule(candidate, challenge, fixture = defaultFixtures["color-cascade-18"]) {
  const checks = [];
  checks.push(await check("required exports", "logic", () => requireFunctions(candidate, ["dropPair", "resolve"])));
  const board = challenge?.board;
  checks.push(await check("challenge shape: 72 cells, 4 colors, gravity packed", "headline", () => validChallengeBoard(board)));

  let reference;
  checks.push(await check("reference oracle: exact 18 × 4 and all clear", "headline", () => {
    reference = puyoOracle.resolve(board);
    return reference.chainCount === 18
      && reference.steps.length === 18
      && reference.steps.every((step) => step.cleared.length === 4)
      && reference.finalBoard.flat().every((cell) => cell === 0);
  }));
  checks.push(await check("candidate challenge trace equals oracle", "logic", async () => (
    same(await candidate.resolve(clone(board)), reference)
  )));

  const variants = validChallengeBoard(board) ? [
    board.map((row) => row.toReversed()),
    board.map((row) => row.map((cell) => [0, 2, 3, 4, 1][cell])),
  ] : [];
  const boards = [...(fixture.boards ?? []), ...variants];
  checks.push(await check(`resolve differential (${boards.length} boards)`, "robustness", async () => {
    for (const item of boards) {
      if (!same(await candidate.resolve(clone(item)), puyoOracle.resolve(item))) return false;
    }
    return true;
  }));
  checks.push(await check(`dropPair differential (${fixture.pairs?.length ?? 0} cases)`, "logic", async () => {
    for (const { board: item, pair } of fixture.pairs ?? []) {
      if (!same(await candidate.dropPair(clone(item), clone(pair)), puyoOracle.dropPair(item, pair))) return false;
    }
    return true;
  }));
  return summarize("color-cascade-18", fixture, checks);
}

export async function evaluateCubeModule(candidate, fixture = defaultFixtures["prism-twist"]) {
  const checks = [];
  const required = ["createSolved", "applyMove", "applyAlgorithm", "invertAlgorithm", "isSolved", "generateScramble", "serialize"];
  checks.push(await check("required exports", "logic", () => requireFunctions(candidate, required)));
  checks.push(await check("solved representation", "logic", async () => same(await candidate.createSolved(), cubeOracle.createSolved())));
  checks.push(await check(`deterministic scramble (${fixture.seeds?.length ?? 0} seeds)`, "robustness", async () => {
    for (const { seed, length } of fixture.seeds ?? []) {
      if (!same(await candidate.generateScramble(seed, length), cubeOracle.generateScramble(seed, length))) return false;
    }
    return true;
  }));

  const algorithms = [
    ...(fixture.algorithms ?? []),
    ...(fixture.seeds ?? []).map(({ seed, length }) => cubeOracle.generateScramble(seed, length)),
  ];
  checks.push(await check(`move states equal oracle (${algorithms.length} algorithms)`, "logic", async () => {
    for (const algorithm of algorithms) {
      const solved = await candidate.createSolved();
      if (!same(await candidate.applyAlgorithm(solved, algorithm), cubeOracle.applyAlgorithm(cubeOracle.createSolved(), algorithm))) {
        return false;
      }
    }
    return true;
  }));
  checks.push(await check("scramble is solved only through inverse moves", "headline", async () => {
    for (const { seed, length } of fixture.seeds ?? []) {
      const scramble = await candidate.generateScramble(seed, length);
      const mixed = await candidate.applyAlgorithm(await candidate.createSolved(), scramble);
      const solved = await candidate.applyAlgorithm(mixed, await candidate.invertAlgorithm(scramble));
      if (await candidate.isSolved(mixed) || !(await candidate.isSolved(solved)) || !same(solved, cubeOracle.createSolved())) {
        return false;
      }
    }
    return true;
  }));
  checks.push(await check("invalid algorithm is atomic", "logic", async () => {
    if (candidate.__atomicAlgorithmProbe) {
      const probe = await candidate.__atomicAlgorithmProbe();
      return probe.threw && same(probe.before, probe.after);
    }
    const state = await candidate.applyMove(await candidate.createSolved(), "R");
    const before = Array.from(state);
    let threw = false;
    try { await candidate.applyAlgorithm(state, ["U", "NOPE", "F"]); } catch { threw = true; }
    return threw && same(Array.from(state), before);
  }));
  return summarize("prism-twist", fixture, checks);
}

function rocketPhysicsCases(count = 180) {
  const cases = [];
  const seeds = [0x10203040, 0x31415926, 0x89abcdef, 0xffffffff];
  const overrides = [
    { phase: 0.73 },
    { g: 9.4, windAmp: 0.4, gustAmp: 0.2 },
    { aMax: 23.5, dragCoeff: 0.01, padX: -10 },
    { g: 10.2, aMax: 20.5, fuel0: 0.55, padX: 10, padHalf: 5.5 },
  ];
  for (let lane = 0; lane < seeds.length && cases.length < count; lane += 1) {
    const params = { ...rocketOracle.DEFAULT_PARAMS, ...overrides[lane] };
    let state = rocketOracle.createScenario(seeds[lane], params).state;
    for (let index = 0; index < 60 && cases.length < count; index += 1) {
      const control = {
        throttle: ((index * 7 + lane) % 15 - 3) / 10,
        gimbal: ((index * 11 + lane * 3) % 19 - 9) / 18,
      };
      cases.push({ state, control, params });
      state = rocketOracle.stepPhysics(state, control, params);
    }
  }
  return cases;
}

function landingDiagnostics(state, params) {
  const safetyMargin = {
    pad: params.padHalf - Math.abs(state.x - params.padX),
    vx: 2 - Math.abs(state.vx),
    vy: 3 - Math.abs(state.vy),
    theta: 8 * Math.PI / 180 - Math.abs(state.theta),
    omega: 15 * Math.PI / 180 - Math.abs(state.omega),
  };
  return {
    landingTime: state.t,
    fuel: state.fuel,
    safetyMargin,
    minSafetyMargin: Math.min(...Object.values(safetyMargin)),
  };
}

export async function evaluateRocketModules(sim, controller, fixture = defaultFixtures["lander-pop"]) {
  const checks = [];
  checks.push(await check("required exports", "logic", () => {
    requireFunctions(sim, ["createScenario", "stepPhysics", "makeSensor", "classify"]);
    requireFunctions(controller, ["createController"]);
  }));
  const scenarios = fixture.scenarios ?? [];
  checks.push(await check(`scenario generation (${scenarios.length} seeds)`, "logic", async () => {
    for (const { seed, overrides = {} } of scenarios) {
      if (!same(await sim.createScenario(seed, overrides), rocketOracle.createScenario(seed, overrides), 1e-10)) return false;
    }
    return true;
  }));
  const physics = fixture.physics ?? rocketPhysicsCases();
  checks.push(await check(`physics differential (${physics.length} steps)`, "robustness", async () => {
    for (const { state, control, params } of physics) {
      if (!same(await sim.stepPhysics(clone(state), clone(control), clone(params)), rocketOracle.stepPhysics(state, control, params), 1e-10)) {
        return false;
      }
    }
    return true;
  }));

  const terminalStates = [
    { t: 1, x: 0, y: 10, vx: 0, vy: 0, theta: 0, omega: 0, fuel: 0.5 },
    { t: 1, x: 0, y: 0, vx: 0, vy: -3, theta: 0, omega: 0, fuel: 0.5 },
    { t: 1, x: 7, y: 0, vx: 0, vy: 0, theta: 0, omega: 0, fuel: 0.5 },
    { t: 20, x: 0, y: 10, vx: 0, vy: 0, theta: 0, omega: 0, fuel: 0.5 },
    { t: 1, x: 0, y: 0, vx: 0, vy: 0, theta: 9 * Math.PI / 180, omega: 0, fuel: 0.5 },
  ];
  const params = { ...rocketOracle.DEFAULT_PARAMS, phase: 0 };
  checks.push(await check("sensor and terminal classifications", "logic", async () => {
    for (const state of terminalStates) {
      if (!same(await sim.makeSensor(state, params), rocketOracle.makeSensor(state, params), 1e-10)
        || await sim.classify(state, params) !== rocketOracle.classify(state, params)) return false;
    }
    return true;
  }));

  const landings = [];
  for (const scenario of scenarios) {
    try {
      const { state: initial, params: scenarioParams } = rocketOracle.createScenario(scenario.seed, scenario.overrides ?? {});
      const autopilot = await controller.createController();
      let state = initial;
      let status = rocketOracle.classify(state, scenarioParams);
      for (let physicsStep = 0; physicsStep < 1000 && status === "flying"; physicsStep += 5) {
        const control = await autopilot.step(rocketOracle.makeSensor(state, scenarioParams));
        for (let held = 0; held < 5 && status === "flying"; held += 1) {
          state = rocketOracle.stepPhysics(state, control, scenarioParams);
          status = rocketOracle.classify(state, scenarioParams);
        }
      }
      landings.push({ seed: scenario.seed, status, ...landingDiagnostics(state, scenarioParams) });
    } catch (error) {
      landings.push({ seed: scenario.seed, status: "controller-error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  const requiredLandings = scenarios.length <= 1 ? scenarios.length : Math.ceil(scenarios.length * 0.8);
  checks.push(await check(`oracle-sim landing (${requiredLandings}/${scenarios.length} required)`, "headline", () => (
    landings.filter(({ status }) => status === "landed").length >= requiredLandings
  )));
  return summarize("lander-pop", fixture, checks, { landings });
}

async function loadFixture(taskId, fixtureFile) {
  if (!fixtureFile) return clone(defaultFixtures[taskId]);
  const value = JSON.parse(await readFile(path.resolve(fixtureFile), "utf8"));
  if (value?.taskId && value.taskId !== taskId) throw new Error(`fixture taskId must be ${taskId}`);
  return value.fixture ?? value;
}

export async function evaluateSubmission(taskId, submissionDirectory, fixtureFile) {
  if (!TASKS.has(taskId)) throw new Error(`unknown task: ${taskId}`);
  const fixture = await loadFixture(taskId, fixtureFile);
  const clients = [];
  try {
    if (taskId === "color-cascade-18") {
      const root = path.resolve(submissionDirectory);
      const challengeFile = path.join(root, "challenge.json");
      const challengeInfo = await lstat(challengeFile);
      if (!challengeInfo.isFile() || challengeInfo.size > 100_000) throw new Error("challenge.json must be a file no larger than 100 KB");
      const challenge = JSON.parse(await readFile(challengeFile, "utf8"));
      const client = await startCandidateClient(taskId, root);
      clients.push(client);
      return await evaluatePuyoModule(client.module("engine"), challenge, fixture);
    }
    if (taskId === "prism-twist") {
      const client = await startCandidateClient(taskId, submissionDirectory);
      clients.push(client);
      return await evaluateCubeModule(client.module("engine"), fixture);
    }
    if (await controllerImportsSimulation(submissionDirectory)) {
      return summarize("lander-pop", fixture, [{
        name: "controller sensor-only contract",
        kind: "logic",
        pass: false,
        detail: "controller.mjs must not import sim.mjs or rocket.mjs",
      }]);
    }
    const simClient = await startCandidateClient("lander-pop-sim", submissionDirectory);
    clients.push(simClient);
    const controllerClient = await startCandidateClient("lander-pop-controller", submissionDirectory);
    clients.push(controllerClient);
    return await evaluateRocketModules(simClient.module("sim"), controllerClient.module("controller"), fixture);
  } finally {
    await Promise.all(clients.map(client => client.close()));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  const [taskId, submissionDirectory, fixtureFile] = process.argv.slice(2);
  if (!taskId || !submissionDirectory) {
    console.error("Usage: node scripts/evaluate-submission.mjs <task-id> <submission/site> [fixture.json]");
    process.exitCode = 2;
  } else if (process.env.LIGHTBENCH_ISOLATED !== "1") {
    console.error("Refusing to execute candidate code. Re-run inside the no-network sandbox with LIGHTBENCH_ISOLATED=1.");
    process.exitCode = 2;
  } else {
    evaluateSubmission(taskId, submissionDirectory, fixtureFile)
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
        if (!result.pass) process.exitCode = 1;
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
      });
  }
}
