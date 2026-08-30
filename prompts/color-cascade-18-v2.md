# ぷよぷよ風・seed配置プランナー＋18連鎖全消し

Prompt version: `PUYO-2.0`

`common-coding-v1.4.md`の本文へ次を連結する。

```text
課題: ぷよぷよ風・seed配置プランナー＋18連鎖全消し

誰が見ても「ぷよぷよ風の落ちものゲーム」だと分かるブラウザ作品を実装してください。公開goalを完成盤面としてコピー表示するだけではなく、空盤面から2個組を35回合法に落としてgoalを組み立て、最後の1組を落とすと実ロジックでちょうど18連鎖・全消しになる配置手順をplanChallengeで毎回計算してください。

ファイル:
- submission/site/index.html
- submission/site/engine.mjs
- submission/site/challenge.json

見た目:
- [data-lightbench-stage] を主役にしたfull viewportの縦長6列フィールドに、丸く柔らかい4色の色ぷよを描画してください。四角い宝石・文字タイルは禁止です。
- 操作中の2個組とNEXTを見せ、Challenge実行時は空盤面から35組の配置、最後のtrigger、各消去wave、重力落下、18 CHAIN、ALL CLEARまで盤面上で再演してください。
- 色以外に表情や模様を併用し、HUDはseed、placed pairs、chain、statusなど4〜6値に限定してください。Manual/Speed/Pause/Replay UIは作りません。
- 公式logo、既存ゲームの画像・音源・固有キャラクターは使わず、自作してください。

盤面ルール:
- boardはboard[y][x]、x=0が左、y=0が床。width=6、height=14、空=0、色=1〜4です。
- 上下左右でつながる同色4個以上を1 groupとし、1 waveですべてのgroupを同時消去してから列ごとに下へ圧縮します。消去がなくなるまで繰り返し、1 waveを1 chainと数えます。
- garbage、bonus score、特殊ブロックはありません。

engine.mjsの必須export:
export const RULES
export function dropPair(board, pair)
export function resolve(board)
export function planChallenge(goal, seed)

dropPair:
- pairは {x,rotation,colors:[pivotColor,childColor]}。rotationは0=上、1=右、2=下、3=左です。
- pairは形を保って下がり、接地後に支えのない横置きの半分だけが自列で落下します。
- 引数を破壊せず、成功時は{ok:true,board}、不正入力または収まらない場合は{ok:false,board,reason}を返します。reasonはinvalidまたはoverflowです。

resolveの戻り値:
{
  finalBoard,
  chainCount,
  steps:[{chain,groups:[{color,cells:[[x,y],...]}],cleared:[[x,y],...],boardAfter}]
}
cellsとclearedはy、次にxの昇順。boardAfterは消去と重力後です。

planChallenge(goal,seed):
- goalは{board,pair}、seedはuint32です。引数を破壊せず、同じ入力には同じ結果を返してください。
- 戻り値は {seed,setupPairs,triggerPair}。setupPairsは正確に35組、triggerPairはgoal.pairと同じ内容です。
- 空盤面へsetupPairsを順にdropPairすると途中消去を一度も起こさず、最後にgoal.boardと完全一致しなければなりません。その後triggerPairをdropPairしてresolveすると、各wave正確に4個を消す18 chainとなり、finalBoardが空でなければなりません。
- seedは合法な配置順の選択に使い、goalが同じでもseed 0、1、2、3のsetupPairsは3種類以上にしてください。
- 評価器は色置換・左右反転した未知goalと未知seedを渡します。公開goal専用の35組リスト、14×6盤面のengine.mjsへの埋め込み、seed/URL/時刻を見た特別分岐は禁止です。goalの各列を読み、縦置きと隣接列への横置きを組み合わせて合法手順を計算してください。

challenge.jsonは次の公開入力だけを保存してください。キーや数値を変更しないでください。
{"seed":305419896,"goal":{"board":[[1,3,3,4,1,3],[1,1,4,3,1,1],[4,2,3,4,2,4],[1,4,4,1,1,4],[0,4,1,2,1,4],[0,2,3,3,4,1],[0,1,2,4,1,3],[0,4,2,3,1,3],[0,1,3,1,4,3],[0,4,1,1,2,2],[0,4,4,3,2,4],[0,1,1,2,4,1],[0,3,1,2,0,1],[0,0,3,0,0,2]],"pair":{"x":0,"rotation":0,"colors":[4,3]}}}

公開再演:
- load時とreset後は空盤面、公開goal、seedからplanChallengeを計算した状態に戻してください。
- runChallengeは同じdropPairとresolveへplanの実入力を渡し、35組の配置、trigger、18 stepを順番にanimationします。最後のframe描画後にPromiseをresolveしてください。
- window.__LIGHTBENCH__へreset、runChallenge、snapshot、logを公開し、resetは古いtimer/animationを停止します。
- snapshot/log/HUD/成功表示はplan、dropPair、resolveの実状態から導出し、予定chain数やDOM文言を判定根拠にしてはいけません。
```
