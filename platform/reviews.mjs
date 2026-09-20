import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
export function validateReview(review){
 if(!review || typeof review.runId!=='string' || !/^\d{4}-[\w-]+$/.test(review.runId) || typeof review.reviewer!=='string' || !review.reviewer.trim() || review.reviewer.length>80 || typeof review.notes!=='string' || !review.notes.trim() || review.notes.length>3000)throw new Error('Review needs a runId, reviewer, and notes');
 for(const key of ['naturalness','gyaru','factuality'])if(!Number.isInteger(review[key])||review[key]<1||review[key]>5)throw new Error(`${key} must be 1–5`);
 return Object.fromEntries(['runId','reviewer','notes','naturalness','gyaru','factuality'].map(k=>[k,review[k]]));
}
export async function addReview(file){
 const review=validateReview(JSON.parse(await readFile(file,'utf8')));
 const run=JSON.parse(await readFile(path.join('results/runs',review.runId,'run.json'),'utf8'));
 if(!run.tasks.chat.response?.text)throw new Error('This run has no Japanese answer');
 await mkdir('results/reviews',{recursive:true});
 const id=randomUUID(),record={id,createdAt:new Date().toISOString(),...review};
 await writeFile(path.join('results/reviews',id+'.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});return id;
}
if(import.meta.main)addReview(process.argv[2]).then(console.log).catch(error=>{console.error(error.message);process.exitCode=1;});
