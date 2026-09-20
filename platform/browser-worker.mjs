import { evaluate } from './evaluate.mjs';
self.onmessage=async({data})=>{
  try {self.postMessage(await evaluate(data.task,data.source,data.seed));}
  catch(error){self.postMessage({status:'infra-error',error:String(error.message).slice(0,500)});}
};
