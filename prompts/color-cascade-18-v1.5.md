# ぷよぷよ風・18連鎖全消し

Prompt version: `PUYO-1.5`

`common-coding-v1.4.md`の本文へ次を連結する。

```text
課題: ぷよぷよ風・18連鎖全消し

誰が見ても「ぷよぷよ風の落ちものゲーム」だと分かるブラウザゲームを実装してください。6列×14行、4色の丸い色ぷよが2個1組で落下する通常プレイに加え、全モデル共通の公開盤面から、あなたが実装した実ロジックでちょうど18連鎖し、最後に全消しするChallenge Modeを作ってください。

見た目の必須条件:
- [data-lightbench-stage] を主役にしたfull viewportの縦長6列フィールドを作り、cellは四角い宝石や文字タイルではなく、隣同士が接して見える丸く柔らかい色ぷよとして描画してください。
- 操作中の2個組と「次の2個」が視覚的に分かり、左右移動・回転・落下という定番の遊び方を初見で理解できる見た目にしてください。
- 連鎖時は消える色ぷよ、落下、連鎖数、全消しを盤面上の動きとして見せてください。抽象的な記号列や完成メッセージだけの代替表示は禁止です。
- 公式logo、既存ゲームの画像・音源・固有キャラクターは使わず、形状・表情・UI装飾は自作してください。
- 状態表示は盤面上の小さなoverlay HUD（chain、mode、statusなど4〜6値）に限定してください。Manual/Speed/Pause/Replayボタン、debug dashboard、長い説明パネルは作らず、外側parentの操作に任せてください。
- 丸ぷよ、6列フィールド、落下する2個組、NEXT表示、消去と重力を必須にしてください。Manual操作用のUIは作らないでください。

ファイル:
- submission/site/index.html
- submission/site/engine.mjs
- submission/site/challenge.json

ルール:
- boardは board[y][x]。x=0が左、y=0が床です。
- width=6、height=14、空=0、色=1〜4です。
- 上下左右でつながる同色4個以上をgroupとします。
- 1 waveでは該当するすべてのgroupを同時に消します。
- その後、各列を下方向へ圧縮し、再びgroupを探します。
- 消去対象がなくなるまで繰り返し、1 waveを1 chainとして数えます。
- garbage、bonus score、特殊ブロックはありません。

engine.mjs は次をexportしてください。

export const RULES
export function dropPair(board, pair)
export function resolve(board)

pairは { x, rotation, colors:[pivotColor, childColor] } です。
rotationは 0=上、1=右、2=下、3=左です。pairは形を保って下がり、どちらかが床または既存cellへ接触したらlockし、支えのない半分だけをその列で落下させます。引数のboardを破壊しないでください。戻り値は成功時に {ok:true,board}、不正入力または盤面外へ収まらない場合に {ok:false,board,reason} とし、失敗時のboardは元盤面と同じ内容のcopy、reasonは invalid または overflow にしてください。

resolve(board) の戻り値:
{
  finalBoard,
  chainCount,
  steps: [
    {
      chain,
      groups: [{ color, cells:[[x,y], ...] }],
      cleared:[[x,y], ...],
      boardAfter
    }
  ]
}

cells、clearedは y、次にxの昇順にしてください。各stepのboardAfterは消去と重力の完了後です。

challenge.json:
- { "board": [...], "pair": { "x": 0, "rotation": 1, "colors": [3, 3] } } だけを含めます。
- boardは重力で下詰めされ、1〜4をすべて使用し、非zero cellは正確に70個にしてください。
- まずchallenge.boardへchallenge.pairを実際にdropPairし、72 cellの盤面を得てください。その盤面をresolveした結果が正確に18 chainであること。
- 各chainで消えるcellは正確に4個であること。
- 18 chain後のfinalBoardが完全に空であること。
- chain数や成功フラグをJSONへ書かないでください。
- 完成盤面の探索は今回の評価対象ではありません。次の公開boardとpairを1字も変えずchallenge.jsonへ保存し、dropPairとresolveとUIへ実入力として渡してください。chain数や成功フラグをJSONへ追加してはいけません。

{ "board": [[4,4,4,2,2,3],[4,3,2,4,2,1],[1,1,3,3,1,4],[1,2,4,4,1,4],[4,2,3,2,2,4],[1,1,3,3,4,1],[0,4,2,4,1,3],[0,1,2,3,1,3],[0,4,3,1,4,3],[0,4,1,1,2,2],[0,1,4,3,2,4],[0,0,1,2,4,1],[0,0,1,2,0,1],[0,0,3,0,0,2]], "pair": { "x": 0, "rotation": 1, "colors": [3,3] } }

公開再演シナリオ（public-v1）:
- public-v1は submission/site/challenge.json の固定されたboardとpairを入力にします。runごとに別のboardを生成したり、乱数、現在時刻、frame時間、DOM表示へ結果を依存させないでください。
- resetしてから同じ runChallenge を実行すると、resolveの各step、finalBoard、chainCount、判定、event logが同じ順序・内容になるようにしてください。challenge.jsonは実際のresolveへ渡し、表示用に結果を捏造してはいけません。

画面:
- challenge.jsonを読み、まず同じdropPairへboardとpairを渡し、その戻り値を同じresolveへ渡してChallenge Modeのstepを順番にanimationしてください。Manual操作用の画面UIは不要です。
- 現在chain数、消去cell、次の盤面が視覚的に分かるようにしてください。
- 最終盤面が実際に空のときだけ「全消し / ALL CLEAR」を表示してください。
- 色以外に表情や模様も併用し、色覚だけに依存しない表示にしてください。ただし丸い色ぷよとしての見た目は保ってください。
- window.__LIGHTBENCH__ に reset、runChallenge、snapshot、log を公開してください。resetは進行中のtimer/animationを停止して初期状態と空のevent logへ戻してください。runChallengeはPromiseを返し、最後のresolve stepの表示animationが終端（animation無効なら最終盤面の表示同期完了）に達してからresolveしてください。同じresolve結果とevent logを使い、animation無効でも実行可能にしてください。
- chain数、全消し、statusなどの画面表示と公開snapshot/logは、resolveが返した実盤面・step・event logから導出してください。DOMテキストや予定されたchain数を判定の根拠にしてはいけません。
```
