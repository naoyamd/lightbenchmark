# 3×3 ルービックキューブ

Prompt version: `CUBE-1.3`

`common-coding-v1.3.md`の本文へ次を連結する。

```text
課題: 3×3 ルービックキューブ

誰が見ても「3×3のルービックキューブ」だと分かる、ブラウザで操作可能な3Dパズルを実装してください。seedから生成したscrambleを実際のface回転で適用し、そのscrambleの逆操作を1手ずつ再生して六面を完成させてください。状態を直接solvedへ置き換えてはいけません。任意状態用の最適solverは不要です。

見た目の必須条件:
- [data-lightbench-stage] を主役にしたfull viewportの立体stageに、各面3×3の正方形ステッカーとcubie間の黒または濃色の隙間を配置してください。宝石、プリズム、半透明多面体などへの抽象化は禁止です。
- UI上の色対応は U=白、D=黄、F=緑、B=青、R=赤、L=オレンジとし、反対面は白/黄、緑/青、赤/オレンジにしてください。
- play中とsolve中は、対象の1層が立体のまま90度回転する様子を見せてください。完成状態へ瞬間的に描き替えるだけの演出は禁止です。scrambleは初期準備操作なので、実際のapplyMoveとlogを順に実行して最終状態を描画すれば十分です。
- 公式logo、既存製品の画像・3D assetは使わず、キューブとUIは自作してください。
- 画面の操作ボタン、速度、Pause/Replayは外側parentが提供するため作らず、stage内のHUDはmove、phase、solvedなど4〜6値のoverlayだけにしてください。

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
F: (0,0,1),  (1,0,0), (0,1,0)
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

公開再演シナリオ（public-v1）:
- 公開scrambleは上記の固定seedとlengthから毎回生成し、reset→scramble→playを繰り返してもtoken列、各状態、solved判定、event logが同じ順序・内容になるようにしてください。乱数、現在時刻、frame時間、DOM表示へ結果を依存させないでください。
- scrambleとplayは、画面に表示するための状態を直接置き換えず、必須moduleの実際のface回転とそのevent logを順に再演してください。

画面:
- CSS 3Dまたはnative canvasで、標準的な3×3キューブの立体と各ステッカーの状態が分かるようにしてください。mouse/touch dragの視点回転とface/keyboardの手動回転は必要ならstageへ実装してください。
- scrambleは実際のface回転ロジックで状態を作り、初期準備として2秒以内に状態確定と描画同期まで完了するPromiseにしてください。playは各face回転の立体animationを見せる公開操作とし、SolveはinvertAlgorithm(scrambleTokens)を使い、applyMoveを1手ずつ呼んでください。
- 各手を {seq,token,state,solved} としてlogし、最後の状態をisSolvedで確認した場合だけ完成演出を出してください。
- window.__LIGHTBENCH__ に reset、scramble、play、snapshot、log を公開してください。resetは進行中のtimer/animationを停止してpublic-v1の初期状態と空のevent logへ戻してください。scrambleとplayはPromiseを返し、最後のface回転の表示animationが終端（animation無効なら最終状態の表示同期完了）に達してからresolveしてください。
- UIのscramble、solved、完成演出、snapshot、logは実際のUint8Array状態、isSolved、face回転のevent logから導出してください。DOMの文字や予定回数を判定の根拠にしてはいけません。
```
