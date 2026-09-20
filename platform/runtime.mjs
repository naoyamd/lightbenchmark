import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';

// There are deliberately no host functions, filesystem, network, or module loader.
// A caller must also use an outer worker deadline: native builtins can delay interrupts.
export async function createCandidate(source, { callMs = 3000, memoryBytes = 64 * 1024 * 1024 } = {}) {
  if (typeof source !== 'string' || source.length > 256000) throw new Error('Candidate source must be at most 256 KB');
  const module = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(memoryBytes);
  runtime.setMaxStackSize(512 * 1024);
  runtime.removeModuleLoader();
  let deadline = Date.now() + callMs;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext();
  let exports, bridge;
  function unwrap(result) {
    if (!result.error) return result.value;
    let message;
    try { message = context.dump(result.error)?.message ?? 'Candidate execution failed'; }
    finally { result.error.dispose(); }
    throw new Error(String(message).slice(0, 500));
  }
  function dispose() {
    exports?.dispose(); bridge?.dispose(); context.dispose(); runtime.dispose();
  }
  try {
    bridge = unwrap(context.evalCode('((parse,stringify,Error)=>(fn,text)=>{const args=parse(text),before=stringify(args),value=fn(...args);if(stringify(args)!==before)throw new Error("Candidate mutated its input");return stringify(value)})(JSON.parse,JSON.stringify,Error)'));
    exports = unwrap(context.evalCode(source, 'candidate.mjs', { type: 'module' }));
    return {
      call(name, ...args) {
        deadline = Date.now() + callMs;
        const fn = context.getProp(exports, name);
        let input, output;
        try {
          if (context.typeof(fn) !== 'function') throw new Error(`Missing export: ${name}`);
          input = context.newString(JSON.stringify(args));
          output = unwrap(context.callFunction(bridge, context.undefined, fn, input));
          if (context.typeof(output) !== 'string') return null;
          const text = context.getString(output);
          if (text.length > 2_000_000) throw new Error('Candidate result exceeds 2 MB');
          return JSON.parse(text);
        } finally { output?.dispose(); input?.dispose(); fn.dispose(); }
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
