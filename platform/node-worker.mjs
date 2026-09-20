import { parentPort, workerData } from 'node:worker_threads';
import { evaluate } from './evaluate.mjs';
try { parentPort.postMessage(await evaluate(workerData.task,workerData.source,workerData.seed)); }
catch(error) { parentPort.postMessage({status:'infra-error',error:String(error.message).slice(0,500)}); }
