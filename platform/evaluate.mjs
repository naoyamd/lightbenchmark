import { createCandidate } from './runtime.mjs';
import * as puyo from '../evaluator/puyo.mjs';
import * as cube from '../evaluator/cube.mjs';
import { simulateArm } from './arm-engine.mjs';

const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const emptyBoard = () => Array.from({length:14},()=>Array(6).fill(0));
const moves = [...'URFDLB'].flatMap(face=>['',"'",'2'].map(s=>face+s));
const specs = {U:[1,1,-1],R:[0,1,-1],F:[2,1,-1],D:[1,-1,1],L:[0,-1,1],B:[2,-1,1]};
const stateArray = state => Array.from(state);
function assert(value,message) { if(!value) throw new Error(message); }
function assertResolution(actual,expected){
  assert(actual && equal(actual.finalBoard,expected.finalBoard) && actual.chainCount===expected.chainCount,'resolve differs from independent evaluator');
  assert(Array.isArray(actual.steps) && actual.steps.length===expected.steps.length,'Missing clear/fall steps');
  for(let i=0;i<expected.steps.length;i++){
    const a=actual.steps[i],e=expected.steps[i];
    assert(equal(a?.boardAfter,e.boardAfter) && equal([...(a?.cleared??[])].sort(),[...e.cleared].sort()),`Incorrect chain step ${i+1}`);
  }
}
function unknownBoards(seed){
  let state=(seed^0x3965b2d1)>>>0||1;
  const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  return Array.from({length:4},()=>{
    const board=emptyBoard();
    for(let x=0;x<6;x++){const height=3+random()%8;for(let y=0;y<height;y++)board[y][x]=1+random()%4;}
    const x=random()%5,color=1+random()%4;
    for(let y=0;y<2;y++){board[y][x]=color;board[y][x+1]=color;}
    return board;
  });
}
function algorithm(value,max=300) {
  assert(Array.isArray(value) && value.length <= max && value.every(m=>moves.includes(m)), 'Expected a legal move array');
  return value;
}

export async function evaluate(task, source, seed) {
  assert(['puyo','cube','arm'].includes(task),'Unknown code task');
  assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff,'Seed must be uint32');
  const checks = [], start = Date.now();
  let candidate, replay = null;
  function check(name, fn) {
    try { const value=fn(); checks.push({name,passed:true}); return value; }
    catch(error) { checks.push({name,passed:false,detail:String(error.message).slice(0,500)}); return null; }
  }
  try {
    candidate = await createCandidate(source);
    if (task === 'puyo') {
      const frames=[{board:emptyBoard(),phase:'setup',chain:0,placed:null}], setupPairs=[];
      let board=emptyBoard(), triggerPair=null;
      const color=1+(seed%4), test=emptyBoard();
      for(let x=0;x<4;x++)test[0][x]=color;
      test[2][4]=1; test[3][4]=2;
      check('消去・重力',()=>{
        for(const board of [test,...unknownBoards(seed)])assertResolution(candidate.call('resolve',board),puyo.resolve(board));
      });
      check('合法配置・範囲外',()=>{
        for(const pair of [{x:seed%5,rotation:1,colors:[color,2]},{x:5,rotation:1,colors:[1,2]},{x:2,rotation:2,colors:[2,3]}]){
          const expected=puyo.dropPair(emptyBoard(),pair),actual=candidate.call('dropPair',emptyBoard(),pair);
          assert(actual?.ok===expected.ok && equal(actual.board,expected.board),'dropPair differs from independent evaluator');
        }
      });
      let chainCount=0,allClear=false;
      check('空盤面から18連鎖・72個全消し',()=>{
        const plan=candidate.call('plan',seed);
        assert(plan && Array.isArray(plan.setupPairs) && plan.setupPairs.length===35 && plan.triggerPair,'plan must return 35 setup pairs and a trigger');
        triggerPair=plan.triggerPair;
        for(const [index,pair] of [...plan.setupPairs,triggerPair].entries()){
          const expected=puyo.dropPair(board,pair);
          assert(expected.ok,`Illegal pair ${index+1}`);
          const actual=candidate.call('dropPair',board,pair);
          assert(actual?.ok && equal(actual.board,expected.board),`Incorrect drop at pair ${index+1}`);
          board=expected.board;
          const result=puyo.resolve(board);
          frames.push({board,phase:index===35?'trigger':'setup',chain:0,placed:pair});
          if(index<35){assert(result.chainCount===0,`Premature clear at pair ${index+1}`);setupPairs.push(pair);}
          else {
            const actualResult=candidate.call('resolve',board);
            assertResolution(actualResult,result);
            for(let i=0;i<result.steps.length;i++){
              const e=result.steps[i];
              frames.push({board:e.boardAfter,phase:'chain',chain:i+1,cleared:e.cleared,placed:null});
            }
            chainCount=result.chainCount;allClear=result.finalBoard.flat().every(n=>n===0);
            assert(chainCount===18 && allClear,'Plan does not produce exactly 18 chains and all-clear');
          }
        }
      });
      replay={seed,setupPairs,triggerPair,frames,chainCount,allClear};
    } else if(task === 'cube') {
      const solved=stateArray(cube.createSolved()),animations={};
      check('全18手の論理状態',()=>{
        const state=stateArray(cube.applyAlgorithm(cube.createSolved(),cube.generateScramble(seed,7)));
        for(const move of moves)assert(equal(candidate.call('applyMove',state,move),stateArray(cube.applyMove(Uint8Array.from(state),move))),`Incorrect ${move} permutation`);
      });
      check('各層の回転アニメーション',()=>{
        for(const move of moves){
          const [axis,layer,sign]=specs[move[0]],angle=sign*(move.endsWith("'")?-1:1)*(move.endsWith('2')?Math.PI:Math.PI/2);
          const poses=[0,.25,.5,.75,1].map(t=>candidate.call('animate',move,t));
          animations[move]=poses;
          let previous=-1e-6;
          for(let i=0;i<poses.length;i++){
            const p=poses[i],fraction=p?.angle/angle;
            assert(p?.axis===axis && p.layer===layer && Number.isFinite(p.angle),'Invalid axis/layer/angle');
            assert(fraction>=previous-1e-6 && fraction<=1+1e-6 && fraction>=-1e-6,'Animation reverses or overshoots'); previous=fraction;
            if(i===0)assert(Math.abs(p.angle)<1e-6,'Animation must start at zero');
            if(i===4)assert(Math.abs(p.angle-angle)<1e-6,'Animation endpoint is incorrect');
            if(i>0&&i<4)assert(fraction>0&&fraction<1,'Animation skips intermediate rotation');
          }
        }
      });
      let scramble=check('初期化で25手を生成',()=>{
        const sequence=algorithm(candidate.call('scramble',seed),25);
        assert(sequence.length===25,'Scramble must have 25 moves');
        for(let i=1;i<sequence.length;i++)assert(specs[sequence[i][0]][0]!==specs[sequence[i-1][0]][0],'Adjacent scramble moves use the same axis');
        return sequence;
      });
      const frames=[{state:solved,phase:'scramble',index:0,move:null}];
      let solution=[], isSolved=false;
      async function solveChallenge(sequence, display) {
        let state=cube.applyAlgorithm(cube.createSolved(),sequence);
        const solver=await createCandidate(source);
        try {
          const answer=algorithm(solver.call('solve',stateArray(state)));
          for(const [index,move] of answer.entries()){
            const expected=cube.applyMove(state,move),actual=candidate.call('applyMove',stateArray(state),move);
            assert(equal(actual,stateArray(expected)),`Incorrect solution move ${index+1}`);
            state=expected;
            if(display)frames.push({state:stateArray(state),phase:'solve',index:index+1,move});
          }
          assert(cube.isSolved(state),'Solution leaves unsolved faces');
          return answer;
        } finally { solver.dispose(); }
      }
      if(scramble){
        let state=cube.createSolved();
        for(const [index,move]of scramble.entries()){state=cube.applyMove(state,move);frames.push({state:stateArray(state),phase:'scramble',index:index+1,move});}
        try { solution=await solveChallenge(scramble,true);isSolved=true;checks.push({name:'生成した盤面を履歴なしで解く',passed:true}); }
        catch(error){checks.push({name:'生成した盤面を履歴なしで解く',passed:false,detail:error.message});}
      } else checks.push({name:'生成した盤面を履歴なしで解く',passed:false,detail:'No valid scramble'});
      try { await solveChallenge(cube.generateScramble((seed^0x5a3c927f)>>>0,25),false);checks.push({name:'独立生成した未知の盤面',passed:true}); }
      catch(error){checks.push({name:'独立生成した未知の盤面',passed:false,detail:error.message});}
      replay={seed,scramble:scramble??[],solution,frames,solved:isSolved,animations};
    } else {
      replay=simulateArm(seed,candidate);
      for(let count=1;count<=3;count++)checks.push({name:`${count}段の接触・支持`,passed:replay.frames.some(f=>f.stackCount>=count)});
      checks.push({name:'解放・退避後3秒安定',passed:replay.metrics.success,detail:replay.metrics.failedReason??undefined});
    }
  } catch(error) {checks.push({name:'候補の実行',passed:false,detail:String(error.message).slice(0,500)});}
  finally {candidate?.dispose();}
  const passed=checks.filter(c=>c.passed).length;
  return {task,seed,status:passed===checks.length?'pass':passed?'partial':'candidate-fail',passed,total:checks.length,checks,elapsedMs:Date.now()-start,replay};
}
