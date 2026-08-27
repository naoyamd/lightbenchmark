# Prism Twist 3×3

Prompt version: `CUBE-1.0`

`common-coding-v1.md`の本文へ次を連結する。

```text
課題: Prism Twist 3×3

ブラウザで操作できる3Dの3×3 twisty puzzleを作ってください。seedから生成したscrambleを実際のface回転で適用し、そのscrambleの逆操作を1手ずつ再生して六面を完成させてください。状態を直接solvedへ置き換えてはいけません。任意状態用の最適solverは不要です。

ファイル:
- submission/site/index.html
- submission/site/engine.mjs

状態:
- face順は U,R,F,D,L,B。
- Uint8Array(54)を使い、index=face*9+row*3+col。
- solvedでは各faceの9要素がそのface番号0〜5です。
- 座標は x=右、y=上、z=前を正とします。

各faceの normal, right, up:
U: (0,1,0),  (1,0,0),  (0,0,-1)
R: (1,0,0),  (0,0,-1), (0,1,0)
F: (0,0,1),  (1,0,0),  (0,1,0)
D: (0,-1,0), (1,0,0),  (0,0,1)
L: (-1,0,0), (0,0,1),  (0,1,0)
B: (0,0,-1), (-1,0,0), (0,1,0)

facelet位置は p = normal + (col-1)*right + (1-row)*up です。位置とnormalの両方を右手系90度回転し、移動先faceletを求めてください。

外側から見たclockwise move:
U: y=+1を-90度
R: x=+1を-90度
F: z=+1を-90度
D: y=-1を+90度
L: x=-1を+90度
B: z=-1を+90度

許可tokenは U R F D L B と、それぞれの '、2 だけです。

engine.mjs は次をexportしてください。
export function createSolved()
export function applyMove(state, token)
export function applyAlgorithm(state, tokens)
export function invertAlgorithm(tokens)
export function isSolved(state)
export function generateScramble(seed, length)
export function serialize(state)

createSolved、applyMove、applyAlgorithmは新しいUint8Arrayを返し、入力stateを破壊しないでください。invertAlgorithmとgenerateScrambleはtoken配列、serializeは54要素を一意に表すstringを返してください。不正tokenを含むalgorithmは適用前に全体を拒否し、stateを一切変更しないでください。

scramble:
- uint32のxorshift32を使い、seed=0は1として扱います。各nextは x^=x<<13、x^=x>>>17、x^=x<<5 の順で32bit演算し、x>>>0を返します。
- token候補は [U,U',U2,R,R',R2,F,F',F2,D,D',D2,L,L',L2,B,B',B2] の順です。
- 候補indexは nextUint32()%18。直前moveと同じ軸なら候補を再抽選します。
- UIの公開scrambleはseed=0x00C0FFEE、length=25です。

画面:
- CSS 3Dまたはnative canvasで、立体と各faceletの状態が分かるようにする。
- mouse/touch dragで視点を回転できるようにする。
- face buttonまたはkeyboardで手動回転できるようにする。
- Scramble、Solve、Pause、Replay、速度変更を用意する。
- SolveはinvertAlgorithm(scrambleTokens)を使い、applyMoveを1手ずつ呼ぶ。
- 各手を {seq,token,state,solved} としてlogする。
- 最後の状態をisSolvedで確認した場合だけ完成演出を出す。
- window.__LIGHTBENCH__ に reset、scramble、play、snapshot、log を公開する。
- 公式名称、公式logo、黒gridと標準6色の組み合わせは使わず、独自の明るいpaletteと形状にする。
```
