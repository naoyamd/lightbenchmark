import { Worker } from 'node:worker_threads';
import { LIMITS } from './prompts.mjs';

export function evaluateIsolated(task,source,seed,{timeoutMs=LIMITS.evaluationTimeoutMs}={}) {
  return new Promise(resolve=>{
    const worker=new Worker(new URL('./node-worker.mjs',import.meta.url),{workerData:{task,source,seed},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:192}});
    let settled=false;
    function finish(result){if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();resolve(result);}
    const timer=setTimeout(()=>finish({task,seed,status:'candidate-fail',passed:0,total:1,checks:[{name:'実行時間上限',passed:false,detail:`Worker exceeded ${timeoutMs}ms`}],replay:null}),timeoutMs);
    worker.once('message',finish);
    worker.once('error',error=>finish({task,seed,status:'infra-error',error:String(error.message).slice(0,500)}));
    worker.once('exit',code=>{if(!settled)finish({task,seed,status:'infra-error',error:`Worker exited without result (${code})`});});
  });
}
