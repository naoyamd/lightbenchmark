import { cp, mkdir, readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildSite } from '../scripts/build-site.mjs';
import { hash,conditionHash } from './run.mjs';
import { TASK_IDS, VERSION } from './prompts.mjs';
import {validateReview} from './reviews.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function readRecord(file){
  const stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>20*1024*1024)throw new Error('Record must be an ordinary JSON file of at most 20 MiB');
  return JSON.parse(await readFile(file,'utf8'));
}
async function rejectLinks(directory){
  const stat=await lstat(directory).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!stat)return;
  if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error(`Unsafe build directory: ${directory}`);
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(entry.isSymbolicLink())throw new Error(`Symlink cannot enter the published site: ${entry.name}`);
    if(entry.isDirectory())await rejectLinks(path.join(directory,entry.name));
    else if(!entry.isFile())throw new Error('Unsupported filesystem entry');
  }
}
export function validateRun(run) {
  if(run.schemaVersion!==2||run.version!==VERSION||!/^\d{4}-[\w-]+$/.test(run.id)||typeof run.model!=='string'||!run.model||typeof run.conditionHash!=='string'||!/^[0-9a-f]{64}$/.test(run.conditionHash)||!Number.isFinite(Date.parse(run.startedAt))||!Number.isFinite(Date.parse(run.endedAt)))throw new Error('Invalid v2 run metadata');
  for(const task of TASK_IDS){
    const r=run.tasks?.[task];
    if(!r||!['pass','partial','candidate-fail','infra-error','unrated'].includes(r.status)||r.promptHash!==hash(r.prompt)||!Array.isArray(r.trials))throw new Error(`Invalid ${task} record`);
    if(r.source!==null&&r.sourceHash!==hash(r.source))throw new Error('Candidate source hash mismatch');
    if(r.response && (typeof r.response.text!=='string'||r.response.text.length>1_000_000))throw new Error('Invalid response');
    if(task==='chat' && !['unrated','infra-error','candidate-fail'].includes(r.status))throw new Error('Chat needs a separate human review');
    for(const t of r.trials){
      if(t.status==='infra-error')continue;
      if(!Array.isArray(t.checks)||!t.checks.length||t.checks.some(c=>typeof c.name!=='string'||typeof c.passed!=='boolean')||t.passed!==t.checks.filter(c=>c.passed===true).length||t.total!==t.checks.length||t.status!==(t.passed===t.total?'pass':t.passed?'partial':'candidate-fail'))throw new Error('Trial score does not match checks');
      if(t.status==='pass'&&(t.total!==({puyo:3,cube:5,arm:4}[task])||typeof r.source!=='string'||!r.source.trim()))throw new Error('Passing task requires candidate source and the full check set');
    }
    if(task!=='chat'&&r.status!=='infra-error' && !(r.status==='candidate-fail'&&r.source===null&&r.trials.length===0&&r.error)){
      if(r.trials.length!==3)throw new Error('A code task requires three trials');
      const status=r.trials.some(t=>t.status==='infra-error')?'infra-error':r.trials.every(t=>t.status==='pass')?'pass':r.trials.some(t=>t.passed>0)?'partial':'candidate-fail';
      if(status!==r.status)throw new Error('Task score does not match trials');
    }
  }
  return run;
}
export async function buildPlatform(){
  const dist=path.join(root,'dist');
  await rejectLinks(dist);await rejectLinks(path.join(root,'results'));
  await buildSite({distDir:path.join(dist,'archive')});
  await cp(path.join(root,'platform/site'),dist,{recursive:true});
  await mkdir(path.join(dist,'assets'),{recursive:true});await mkdir(path.join(dist,'data'),{recursive:true});
  await build({entryPoints:[path.join(root,'platform/browser-worker.mjs')],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:path.join(dist,'assets/browser-worker.mjs'),minify:true});
  await cp(fileURLToPath(import.meta.resolve('@jitl/quickjs-wasmfile-release-sync/wasm')),path.join(dist,'assets/emscripten-module.wasm'));
  await cp(path.join(root,'platform/vendor/PLANCK-LICENSE.txt'),path.join(dist,'assets/PLANCK-LICENSE.txt'));
  await cp(fileURLToPath(import.meta.resolve('quickjs-emscripten/package.json')).replace(/package\.json$/,'LICENSE'),path.join(dist,'assets/QUICKJS-LICENSE.txt'));
  const reviews=[];
  for(const entry of await readdir(path.join(root,'results/reviews'),{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
    if(!entry.isFile()||entry.isSymbolicLink()||!entry.name.endsWith('.json'))throw new Error('Invalid review entry');
    const review=await readRecord(path.join(root,'results/reviews',entry.name));validateReview(review);reviews.push(review);
  }
  const runs=[];
  for(const entry of await readdir(path.join(root,'results/runs'),{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
    if(!entry.isDirectory()||entry.isSymbolicLink())throw new Error('Run entries must be ordinary directories');
    let run;try{run=await readRecord(path.join(root,'results/runs',entry.name,'run.json'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    validateRun(run);if(run.id!==entry.name)throw new Error('Run directory mismatch');
    if(!/^v2-[\w-]+$/.test(run.cohortId))throw new Error('Invalid cohort ID');
    const cohort=await readRecord(path.join(root,'results/cohorts',run.cohortId+'.json'));
    if(cohort.conditionHash!==conditionHash(cohort)||run.conditionHash!==cohort.conditionHash||run.evaluatorHash!==cohort.evaluatorHash||JSON.stringify(run.limits)!==JSON.stringify(cohort.limits)||JSON.stringify(run.seeds)!==JSON.stringify(cohort.seeds))throw new Error('Run conditions do not match the committed cohort');
    for(const task of TASK_IDS){
      if(hash(run.tasks[task].prompt)!==hash(cohort.prompts[task]))throw new Error('Run prompt does not match cohort');
      for(const [index,trial]of run.tasks[task].trials.entries())if(trial.seed!==cohort.seeds[index])throw new Error('Trial seed does not match cohort');
    }
    run.humanReviews=reviews.filter(review=>review.runId===run.id);
    const target=`data/${run.id}.json`;await writeFile(path.join(dist,target),JSON.stringify(run));
    runs.push({id:run.id,model:run.model,provider:run.provider,startedAt:run.startedAt,conditionHash:run.conditionHash,path:target,statuses:Object.fromEntries(TASK_IDS.map(id=>[id,run.tasks[id].status]))});
  }
  runs.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  await writeFile(path.join(dist,'data/runs.json'),JSON.stringify({schemaVersion:2,version:VERSION,runs},null,2)+'\n');
  await writeFile(path.join(dist,'.nojekyll'),'');
  console.log(`Built v2: ${runs.length} measured runs; old runs preserved in archive/`);
}
if(import.meta.main)buildPlatform().catch(error=>{console.error(error.message);process.exitCode=1;});
