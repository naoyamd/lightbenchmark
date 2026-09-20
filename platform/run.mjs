import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { VERSION, TASK_IDS, PROMPTS, LIMITS } from './prompts.mjs';
import { evaluateIsolated } from './evaluate-node.mjs';

export const hash = value => createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const save = async (file,value) => {
  try {await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
  catch(error){error.checkpointFailure=true;throw error;}
};
export async function evaluatorHash(){
  const files=['runtime.mjs','evaluate.mjs','evaluate-node.mjs','node-worker.mjs','arm-engine.mjs','vendor/planck.mjs','site/cube-view.mjs','../evaluator/cube.mjs','../evaluator/puyo.mjs','../package-lock.json'];
  return hash(await Promise.all(files.map(async file=>[file,hash((await readFile(new URL(file,import.meta.url),'utf8')).replace(/\r\n/g,'\n'))])));
}
export const conditionHash=cohort=>hash({version:cohort.version,prompts:cohort.prompts,limits:cohort.limits,seeds:cohort.seeds,evaluatorHash:cohort.evaluatorHash});
export function extractSource(text) {
  const match=/^\s*```(?:javascript|js|mjs)?\s*\n([\s\S]*?)\n```\s*$/i.exec(text);
  const source=match?match[1]:text.trim();
  if(!source || source.length>256000)throw new Error('Empty or oversized candidate source');
  return source;
}
export async function createCohort(directory='results/cohorts') {
  await mkdir(directory,{recursive:true});
  const seeds=Array.from({length:3},()=>randomBytes(4).readUInt32LE());
  const cohort={id:`v2-${new Date().toISOString().replace(/[:.]/g,'-')}`,version:VERSION,createdAt:new Date().toISOString(),seeds,prompts:PROMPTS,limits:LIMITS,evaluatorHash:await evaluatorHash()};
  cohort.conditionHash=conditionHash(cohort);
  await save(path.join(directory,cohort.id+'.json'),cohort);
  return cohort;
}
export async function apiCredentials(provider) {
  if(provider==='go'){
    if(process.env.OPENCODE_GO_API_KEY)return process.env.OPENCODE_GO_API_KEY;
    const auth=JSON.parse(await readFile(path.join(process.env.XDG_DATA_HOME??path.join(homedir(),'.local','share'),'opencode','auth.json'),'utf8'));
    if(auth['opencode-go']?.type!=='api'||typeof auth['opencode-go'].key!=='string')throw new Error('OpenCode Go API authentication is not configured');
    return auth['opencode-go'].key;
  }
  if(!process.env.LIGHTBENCH_API_KEY)throw new Error('Set LIGHTBENCH_API_KEY for the compatible API');
  return process.env.LIGHTBENCH_API_KEY;
}
export async function requestCompletion({baseUrl,apiKey,model,prompt,protocol='chat',maxTokens=LIMITS.maxOutputTokens,timeoutMs=LIMITS.requestTimeoutMs,sessionId=randomUUID(),fetchImpl=fetch}) {
  const endpoint={chat:'chat/completions',messages:'messages',responses:'responses'}[protocol];
  if(!endpoint)throw new Error('Unknown API protocol');
  const url=new URL(baseUrl.replace(/\/$/,'')+'/'+endpoint);
  if(url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('API endpoint must use HTTPS (localhost may use HTTP)');
  if(url.username||url.password||url.search||url.hash)throw new Error('API endpoint must not contain credentials, query, or fragment');
  const body=protocol==='messages'?{model,system:prompt.system,messages:[{role:'user',content:prompt.user}],max_tokens:maxTokens,stream:false}:protocol==='responses'?{model,instructions:prompt.system,input:prompt.user,max_output_tokens:maxTokens,stream:false}:{model,messages:[{role:'system',content:prompt.system},{role:'user',content:prompt.user}],max_tokens:maxTokens,stream:false};
  const started=Date.now();
  const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{'Authorization':`Bearer ${apiKey}`,...(protocol==='messages'?{'x-api-key':apiKey,'anthropic-version':'2023-06-01'}:{}),'Content-Type':'application/json','User-Agent':`LightBenchmark/${VERSION}`,'x-opencode-session':sessionId},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`Provider HTTP ${response.status}; no automatic retry`);
  const json=await response.json();
  const choice=json.choices?.[0],text=protocol==='messages'?json.content?.filter(c=>c.type==='text').map(c=>c.text).join(''):protocol==='responses'?(json.output_text??json.output?.flatMap(item=>item.content??[]).filter(c=>c.type==='output_text').map(c=>c.text).join('')):choice?.message?.content;
  if(typeof text!=='string')throw new Error('Provider response is missing the text field');
  const usage=json.usage??{};
  const n=value=>Number.isFinite(value)&&value>=0?value:null;
  const input=n(usage.prompt_tokens??usage.input_tokens),output=n(usage.completion_tokens??usage.output_tokens);
  return {text,modelReturned:typeof json.model==='string'?json.model:null,responseId:typeof json.id==='string'?json.id:null,finishReason:choice?.finish_reason??json.stop_reason??json.status??null,protocol,durationMs:Date.now()-started,usage:{inputTokens:input,outputTokens:output,cachedTokens:n(usage.prompt_tokens_details?.cached_tokens??usage.input_tokens_details?.cached_tokens??usage.cache_read_input_tokens),reasoningTokens:n(usage.completion_tokens_details?.reasoning_tokens??usage.output_tokens_details?.reasoning_tokens),totalTokens:n(usage.total_tokens)??(input!==null&&output!==null?input+output:null),costUsd:n(usage.cost)},costKind:Number.isFinite(usage.cost)?'provider-reported':'not-reported'};
}

export async function runModel({model,cohort,provider='go',baseUrl,protocol,resultsDir='results/runs',request=requestCompletion}) {
  if(!model||model.length>160)throw new Error('A model ID is required');
  if(cohort.conditionHash!==conditionHash(cohort) || cohort.evaluatorHash!==await evaluatorHash() || cohort.version!==VERSION || !Array.isArray(cohort.seeds) || cohort.seeds.length!==3 || cohort.seeds.some(s=>!Number.isInteger(s)||s<0||s>0xffffffff))throw new Error('Invalid or incompatible cohort');
  const apiKey=await apiCredentials(provider);
  baseUrl=baseUrl??(provider==='go'?'https://opencode.ai/zen/go/v1':process.env.LIGHTBENCH_BASE_URL);
  if(!baseUrl)throw new Error('Set LIGHTBENCH_BASE_URL or --base-url');
  if(!['go','compatible'].includes(provider))throw new Error('Unknown provider');
  if(provider==='go'&&baseUrl.replace(/\/$/,'')!=='https://opencode.ai/zen/go/v1')throw new Error('OpenCode credentials may only be sent to the official Go endpoint');
  const modelId=provider==='go'?model.replace(/^opencode-go\//,''):model;
  protocol=protocol??(provider==='go'&&/^(minimax|qwen)/.test(modelId)?'messages':provider==='go'&&/^(gpt|grok|muse)/.test(modelId)?'responses':'chat');
  const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex');
  const directory=path.join(resultsDir,id);await mkdir(directory,{recursive:true});
  const run={schemaVersion:2,id,model:modelId,provider,version:VERSION,cohortId:cohort.id,conditionHash:cohort.conditionHash,evaluatorHash:cohort.evaluatorHash,limits:cohort.limits,seeds:cohort.seeds,startedAt:new Date().toISOString(),endedAt:null,policy:'single-response-no-tools',tasks:{},humanReviews:[]};
  await save(path.join(directory,'started.json'),run);
  for(const task of TASK_IDS){
    console.log(`${id} ${modelId} ${task}: generating`);
    const prompt=cohort.prompts[task],taskRecord={prompt,promptHash:hash(prompt),status:'infra-error',response:null,source:null,trials:[]};
    try {
      taskRecord.response=await request({baseUrl,apiKey,model:modelId,prompt,protocol,maxTokens:cohort.limits.maxOutputTokens,timeoutMs:cohort.limits.requestTimeoutMs});
      // Keep the paid response even if the process is interrupted during evaluation.
      await save(path.join(directory,task+'-response.json'),taskRecord.response);
      if(task==='chat'){taskRecord.status=taskRecord.response.text.trim()?'unrated':'candidate-fail';taskRecord.characterCount=[...taskRecord.response.text].length;}
      else {
        taskRecord.source=extractSource(taskRecord.response.text);taskRecord.sourceHash=hash(taskRecord.source);
        for(const seed of cohort.seeds){
          console.log(`${id} ${task}: evaluating seed ${seed}`);
          const trial=await evaluateIsolated(task,taskRecord.source,seed);
          await save(path.join(directory,`${task}-seed-${seed}.json`),trial);
          taskRecord.trials.push(trial);
        }
        taskRecord.status=taskRecord.trials.some(t=>t.status==='infra-error')?'infra-error':taskRecord.trials.every(t=>t.status==='pass')?'pass':taskRecord.trials.some(t=>t.passed>0)?'partial':'candidate-fail';
      }
    } catch(error){if(error.checkpointFailure)throw error;taskRecord.status=taskRecord.response?'candidate-fail':'infra-error';taskRecord.error=String(error.message).replaceAll(apiKey,'[redacted]').slice(0,500);}
    await save(path.join(directory,task+'.json'),taskRecord);run.tasks[task]=taskRecord;
    console.log(`${id} ${task}: ${taskRecord.status}`);
  }
  run.endedAt=new Date().toISOString();
  await save(path.join(directory,'run.json'),run);
  return run;
}

if(import.meta.main){
  try {
    const [command,...args]=process.argv.slice(2),options={};
    if(command==='cohort'){const c=await createCohort();console.log(`results/cohorts/${c.id}.json`);}
    else if(command==='run'){
      for(let i=0;i<args.length;i+=2){if(!['--model','--cohort','--provider','--base-url','--protocol'].includes(args[i])||!args[i+1])throw new Error('Expected --model ID --cohort PATH [--provider go|compatible] [--base-url URL] [--protocol chat|messages|responses]');options[args[i].slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=args[i+1];}
      options.cohort=JSON.parse(await readFile(options.cohort,'utf8'));
      console.log((await runModel(options)).id);
    } else throw new Error('Usage: node platform/run.mjs cohort | run --model ID --cohort PATH');
  } catch(error){console.error(error.message);process.exitCode=1;}
}
