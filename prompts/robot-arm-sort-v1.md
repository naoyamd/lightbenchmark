# Robot Arm Sort

Prompt version: `ARM-1.0`

`common-coding-v1.4.md`の本文へ次を連結する。

```text
課題: Robot Arm Sort

2リンク平面ロボットアームが、左側の3個の荷物を色対応する右側のbinへ自動搬送するミニセルを作ってください。見た目だけの移動ではなく、順運動学・逆運動学・関節速度制限・障害物回避・把持/解放を同じ内部状態で成立させてください。

ファイル:
- submission/site/index.html
- submission/site/arm.mjs
- submission/site/scenario.json

arm.mjs API:
- `forward(joints, spec)` → `{elbow:[x,y], tool:[x,y]}`。q1は第1linkの絶対角、q2は第2linkの相対角、radです。
- `inverse(target, spec, elbow)` → `[q1,q2]` または到達不能ならnull。elbowは`"up"`/`"down"`です。
- `planSort(scenario)` → `[{t,joints:[q1,q2],grip}, ...]`。純粋かつ決定論的で、入力を破壊しないでください。

仕様:
- `spec={base,links,jointLimits,maxSpeeds,clearance,gripRadius,binRadius,home}`。
- FKは elbow=base+L1*[cos(q1),sin(q1)]、tool=elbow+L2*[cos(q1+q2),sin(q1+q2)]。
- keyframeの先頭は`t=0`、以後は厳密増加。隣接keyframe間は関節角を線形補間し、各関節のabs(dq)/dtがmaxSpeeds以下でなければなりません。
- 地面はy=0。elbowとtoolは常にy>=clearanceです。
- obstacleは軸平行長方形`{minX,maxX,minY,maxY}`。両link線分がclearance分拡張した長方形へ触れてはいけません。荷物把持中はさらに5座標単位の余裕を加えてください。
- gripがfalse→trueになった瞬間、toolからgripRadius以内に未搬送の荷物が正確に1個必要です。true→falseは、その荷物のtargetからbinRadius以内でだけ成功します。
- 3個すべてを搬送し、最後は荷物を離した状態にしてください。
- hidden評価ではpickup、target、obstacle位置とseedが少し変わります。public座標や予定keyframeの固定列ではなく、IKと衝突検査を使って経路を探索してください。

公開再演scenario（public-v1）:
`scenario.json`へ次を改変せず保存してください。
{"seed":305419896,"spec":{"base":[0,0],"links":[150,120],"jointLimits":[[-2.9,2.9],[-2.7,2.7]],"maxSpeeds":[1.2,1.5],"clearance":5,"gripRadius":10,"binRadius":18,"home":[1.5707963267948966,0]},"obstacles":[{"minX":109,"maxX":133,"minY":135,"maxY":170}],"items":[{"id":"cyan","color":"cyan","pickup":[-188,45],"target":[186,48]},{"id":"magenta","color":"magenta","pickup":[-158,89],"target":[160,94]},{"id":"yellow","color":"yellow","pickup":[-202,116],"target":[206,116]}]}

画面:
- [data-lightbench-stage] を作品の主役とするfull viewport stageを作ってください。
- 工場セルとして、太い2本のlink、2関節、開閉するgripper、3色の荷物、対応bin、障害物、安全床を大きく描画してください。アームの姿勢と荷物位置はarm.mjsのkeyframe補間/FK/把持状態から毎frame描画してください。
- 衝突、速度超過、把持失敗は成功にせず、停止して視覚的に赤く示してください。全搬送時だけ実状態からcompleteを表示してください。
- 小さなHUDはstatus、搬送数、q1、q2、gripの5値以内。Manual/Speed/Pause/Replay UIは作らないでください。
- `window.__LIGHTBENCH__` にreset、run、snapshot、logを公開してください。runはplanSortのkeyframeを実時間より短く再生して構いませんが、順序・補間・衝突判定を飛ばさず、最後の描画後にPromiseを完了してください。resetは進行中animationを止め、home姿勢、元の荷物位置、空logへ戻してください。
```
