import test from 'node:test';
import assert from 'node:assert/strict';
import {createCandidate} from './runtime.mjs';
import {evaluateIsolated} from './evaluate-node.mjs';
import {requestCompletion,extractSource,createCohort,runModel,importResponses} from './run.mjs';
import {animationKeyframes,getMoveGeometry,TOKENS} from './site/cube-view.mjs';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validateRun,buildPlatform} from './build.mjs';
import {validateReview} from './reviews.mjs';

test('isolated candidate has no host capabilities, rejects imports and mutation, and disposes',async()=>{
 const c=await createCandidate('export function inspect(){return [typeof process,typeof fetch,typeof require,typeof document]} export function mutate(a){a.x=2;return a}');
 try{assert.deepEqual(c.call('inspect'),['undefined','undefined','undefined','undefined']);assert.throws(()=>c.call('mutate',{x:1}),/mutated/);}finally{c.dispose();}
 await assert.rejects(createCandidate('import fs from "node:fs";export const x=1'),/module|load/i);
 const next=await createCandidate('export function f(){return 7}');assert.equal(next.call('f'),7);next.dispose();
});
test('infinite loop and excessive memory cannot retain the evaluation worker',async()=>{
 const start=Date.now();
 const loop=await evaluateIsolated('puyo','while(true){}',1,{timeoutMs:1800});
 assert.equal(loop.status,'candidate-fail');assert.ok(Date.now()-start<6000);
 const memory=await evaluateIsolated('puyo','const a=[];while(true)a.push(new Uint8Array(1024*1024));',1,{timeoutMs:5000});
 assert.equal(memory.status,'candidate-fail');
});
test('stationary arm cannot claim a stack or bypass gravity/contact',async()=>{
 const result=await evaluateIsolated('arm','export function reset(){};export function step(){return {jointSpeeds:[0,0,0],gripperOpening:.58,success:true,stackCount:3}}',123);
 assert.equal(result.status,'candidate-fail');assert.equal(result.passed,0);assert.equal(result.replay.metrics.success,false);
 assert.ok(result.replay.frames.every(f=>f.stackCount===0));
 assert.deepEqual(result.replay.params.goalSlots.map(b=>b.id),['medium','small','large']);
});
test('the published arm action/observation contract can physically complete all six layouts',async()=>{
 const source=await readFile(new URL('./reference/arm.mjs',import.meta.url),'utf8');
 for(const seed of [1,32,5376,5408,10752,10784]){
  const result=await evaluateIsolated('arm',source,seed);
  assert.equal(result.status,'pass',JSON.stringify(result.checks));
  const final=result.replay.frames.at(-1);
  assert.equal(final.stackCount,3);assert.equal(final.stableSeconds,3);
  assert.ok(final.contacts.includes('block-medium|block-small'));assert.ok(final.contacts.includes('block-large|block-small'));
  assert.ok(!final.contacts.some(c=>c.includes('finger-')&&c.includes('block-')));
 }
});
test('puyo must resolve unseen boards, not only a small probe and its own full plan',async()=>{
 const oracle=await readFile(new URL('../evaluator/puyo.mjs',import.meta.url),'utf8');
 const general=await evaluateIsolated('puyo',oracle,97);
 assert.equal(general.checks.find(c=>c.name==='消去・重力').passed,true);
 const restricted=oracle.replace('export function resolve(board)','function fullResolve(board)')+'\nexport function resolve(board){const n=board.flat().filter(Boolean).length;return n<=6||n===72?fullResolve(board):{finalBoard:board,chainCount:0,steps:[]}}';
 const result=await evaluateIsolated('puyo',restricted,97);
 assert.equal(result.checks.find(c=>c.name==='消去・重力').passed,false);
});
test('out-of-range finite robot commands fail before they move the plant',async()=>{
 for(const command of [{jointSpeeds:[1e300,0,0],gripperOpening:.5},{jointSpeeds:[0,0,0],gripperOpening:.61}]){
  const result=await evaluateIsolated('arm',`export function reset(){};export function step(){return ${JSON.stringify(command)}}`,1);
  assert.equal(result.status,'candidate-fail');assert.equal(result.replay.frames.length,1);assert.match(result.replay.metrics.failedReason,/exceeds/);
 }
});
test('candidate animation samples drive the actual CSS keyframes for all moves',()=>{
 for(const move of TOKENS){const geometry=getMoveGeometry(move);const angle=geometry.cssAngle*Math.PI/180*(geometry.axis===1?1:-1);const poses=[0,.1,.45,.8,1].map(f=>({axis:geometry.axis,layer:geometry.layer,angle:angle*f}));
 const frames=animationKeyframes(move,poses);assert.equal(frames.length,5);assert.match(frames[2].transform,new RegExp(String(geometry.cssAngle*.45).replace('.','\\.')));
 assert.throws(()=>animationKeyframes(move,poses.map(p=>({...p,layer:-p.layer}))),/layer/);
 }
});
test('provider adapter preserves raw output and usage without fabricating absent cost',async()=>{
 let request;
 const response=await requestCompletion({baseUrl:'https://example.test/v1',apiKey:'test-key',model:'test',prompt:{system:'system',user:'ギャルっぽく糸島を紹介して'},fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({id:'test-id',model:'actual',choices:[{message:{content:'  原文\nそのまま✨  '},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:8,total_tokens:20}}),{status:200});}});
 assert.equal(response.text,'  原文\nそのまま✨  ');assert.equal(response.usage.costUsd,null);assert.equal(response.usage.totalTokens,20);assert.equal(request.options.redirect,'error');assert.ok(request.options.headers['x-opencode-session']);
 await assert.rejects(requestCompletion({baseUrl:'https://example.test/v1',apiKey:'secret',model:'x',prompt:{},fetchImpl:async()=>new Response('secret provider error',{status:429})}),/^Error: Provider HTTP 429/);
 assert.equal(extractSource('```js\nexport const x=1\n```'),'export const x=1');
});
test('all provider formats preserve visible text, usage and request roles',async()=>{
 for(const protocol of ['messages','responses']){
  let body;
  const json=protocol==='messages'?{content:[{type:'thinking',thinking:'private reasoning'},{type:'text',text:'回答'}],usage:{input_tokens:3,output_tokens:5},stop_reason:'end_turn'}:{output:[{content:[{type:'output_text',text:'回答'}]}],usage:{input_tokens:3,output_tokens:5},status:'completed'};
  const r=await requestCompletion({protocol,baseUrl:'https://example.test/v1',apiKey:'test',model:'m',prompt:{system:'sys',user:'usr'},fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify(json));}});
  assert.equal(r.text,'回答');assert.equal(r.usage.totalTokens,8);assert.equal(protocol==='messages'?body.system:body.instructions,'sys');assert.doesNotMatch(JSON.stringify(r),/private reasoning/);
 }
});
test('a four-task run saves raw responses, independent failures and immutable conditions',async()=>{
 const prefix=path.join(tmpdir(),'lightbench-v2-test-'),directory=await mkdtemp(prefix),previous=process.env.LIGHTBENCH_API_KEY;
 try{
  process.env.LIGHTBENCH_API_KEY='test-local-key';
  const cohort=await createCohort(path.join(directory,'cohorts'));let calls=0;
  const run=await runModel({provider:'compatible',model:'test-fixture',baseUrl:'https://example.test/v1',cohort,resultsDir:path.join(directory,'runs'),request:async({prompt})=>{calls++;return {text:prompt.user==='ギャルっぽく糸島を紹介して'?'  原文のまま✨\n':'export function reset(){};export function step(){return {jointSpeeds:[0,0,0],gripperOpening:.58}}',usage:{totalTokens:1,costUsd:null}};}});
  assert.equal(calls,4);assert.equal(run.tasks.chat.response.text,'  原文のまま✨\n');assert.equal(run.tasks.arm.status,'candidate-fail');assert.equal(run.tasks.arm.trials.length,3);validateRun(run);
  const saved=JSON.parse(await readFile(path.join(directory,'runs',run.id,'run.json'),'utf8'));assert.deepEqual(saved,run);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory,'runs',run.id,'arm-response.json'),'utf8')),run.tasks.arm.response);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory,'runs',run.id,`arm-seed-${cohort.seeds[0]}.json`),'utf8')),run.tasks.arm.trials[0]);
  const invalid=structuredClone(run);invalid.tasks.arm.status='pass';assert.throws(()=>validateRun(invalid),/score/);
  for(const trial of invalid.tasks.arm.trials){trial.checks=[];trial.passed=0;trial.total=0;trial.status='pass';}assert.throws(()=>validateRun(invalid),/score/);
  const altered=structuredClone(cohort);altered.seeds[0]^=1;await assert.rejects(runModel({model:'test',cohort:altered,provider:'compatible'}),/cohort/);
  assert.throws(()=>validateReview({runId:run.id,reviewer:'test',notes:'根拠',naturalness:6,gyaru:3,factuality:3}),/1–5/);
 }finally{if(previous===undefined)delete process.env.LIGHTBENCH_API_KEY;else process.env.LIGHTBENCH_API_KEY=previous;if(!path.resolve(directory).startsWith(path.resolve(prefix)))throw new Error('Unsafe test cleanup path');await rm(directory,{recursive:true,force:true,maxRetries:3});}
});
test('external outputs reach the published data without credentials or network calls',async()=>{
 const work=fileURLToPath(new URL('../work/',import.meta.url));await mkdir(work,{recursive:true});
 const directory=await mkdtemp(path.join(work,'import-test-')),records=path.join(directory,'results'),dist=path.join(directory,'site');
 const originalFetch=globalThis.fetch,previousKey=process.env.LIGHTBENCH_API_KEY;
 try{
  delete process.env.LIGHTBENCH_API_KEY;globalThis.fetch=()=>{throw new Error('External import attempted a network call');};
  const cohort=await createCohort(path.join(records,'cohorts'));
  const bundle={model:'PRIVATE TEST FIXTURE',conditionHash:cohort.conditionHash,tasks:Object.fromEntries(['chat','puyo','cube','arm'].map(task=>[task,{text:task==='chat'?'  外部の原文✨\n':'export {}'}]))};
  await assert.rejects(importResponses({bundle:{...bundle,conditionHash:'wrong'},cohort,resultsDir:path.join(records,'runs')}),/conditionHash/);
  await assert.rejects(importResponses({bundle:{...bundle,tasks:{...bundle.tasks,chat:{text:'x',usage:{costUsd:-1}}}},cohort,resultsDir:path.join(records,'runs')}),/costUsd/);
  const run=await importResponses({bundle,cohort,resultsDir:path.join(records,'runs')});
  validateRun(run);assert.equal(run.policy,'external-output');assert.equal(run.tasks.chat.response.text,'  外部の原文✨\n');assert.equal(run.tasks.chat.response.usage.totalTokens,null);
  for(const task of ['puyo','cube','arm'])assert.equal(run.tasks[task].status,'candidate-fail');
  await buildPlatform({resultsDir:records,distDir:dist});
  const manifest=JSON.parse(await readFile(path.join(dist,'data/runs.json'),'utf8'));assert.equal(manifest.runs.length,1);assert.equal(manifest.runs[0].model,bundle.model);
  const published=JSON.parse(await readFile(path.join(dist,manifest.runs[0].path),'utf8'));assert.equal(published.tasks.chat.response.text,bundle.tasks.chat.text);
  assert.match(await readFile(path.join(dist,'demo/index.html'),'utf8'),/LLM未実行/);
  assert.ok(manifest.runs.every(r=>!r.model.includes('モデル A')));
 }finally{globalThis.fetch=originalFetch;if(previousKey===undefined)delete process.env.LIGHTBENCH_API_KEY;else process.env.LIGHTBENCH_API_KEY=previousKey;if(!path.resolve(directory).startsWith(path.join(work,'import-test-')))throw new Error('Unsafe test cleanup');await rm(directory,{recursive:true,force:true,maxRetries:3});}
});
