import { createInterface } from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [taskId, submissionDirectory] = process.argv.slice(2);
const files = taskId === 'lander-pop-controller'
  ? { controller: 'controller.mjs' }
  : taskId === 'lander-pop-sim'
    ? { sim: 'sim.mjs' }
    : { engine: 'engine.mjs' };

const modules = {};
for (const [name, file] of Object.entries(files)) {
  modules[name] = await import(pathToFileURL(path.join(submissionDirectory, file)).href);
}

let controller;
const encode = value => {
  if (value instanceof Uint8Array) return { __lightbenchType: 'Uint8Array', data: [...value] };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  return value;
};
const decode = value => {
  if (value?.__lightbenchType === 'Uint8Array') return Uint8Array.from(value.data);
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
  return value;
};
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);

send({
  type: 'ready',
  exports: Object.fromEntries(Object.entries(modules).map(([name, module]) => [
    name,
    Object.keys(module).filter(key => typeof module[key] === 'function'),
  ])),
});

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  let request;
  try {
    request = JSON.parse(line);
    let result;
    if (request.target === 'engine' && request.method === '__atomicAlgorithmProbe') {
      const state = await modules.engine.applyMove(await modules.engine.createSolved(), 'R');
      const before = Array.from(state);
      let threw = false;
      try { await modules.engine.applyAlgorithm(state, ['U', 'NOPE', 'F']); } catch { threw = true; }
      result = { threw, before, after: Array.from(state) };
    } else if (request.target === 'controller' && request.method === 'createController') {
      controller = modules.controller.createController();
      if (!controller || typeof controller.step !== 'function') throw new Error('createController must return { step(sensor) }');
      result = true;
    } else if (request.target === 'controller' && request.method === 'step') {
      if (!controller) throw new Error('controller is not initialized');
      result = await controller.step(...decode(request.args));
    } else {
      const method = modules[request.target]?.[request.method];
      if (typeof method !== 'function') throw new Error(`missing export: ${request.method}`);
      result = await method(...decode(request.args));
    }
    send({ id: request.id, ok: true, result: encode(result) });
  } catch (error) {
    send({
      id: request?.id ?? null,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}
