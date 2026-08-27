# Color Cascade 18

Prompt version: `PUYO-1.0`

`common-coding-v1.md`の本文へ次を連結する。

```text
課題: Color Cascade 18

6列×14行、4色の「同色ブロック落ちものゲーム」を実装してください。通常プレイに加え、あなた自身が設計した盤面から、実ロジックでちょうど18連鎖し、最後に全消しするChallenge Modeを作ってください。

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
- { "board": [...] } だけを含めます。
- boardは重力で下詰めされ、1〜4をすべて使用してください。
- 非zero cellは正確に72個にしてください。
- そのboardをresolveした結果が正確に18 chainであること。
- 各chainで消えるcellは正確に4個であること。
- 18 chain後のfinalBoardが完全に空であること。
- chain数や成功フラグをJSONへ書かないでください。
- 完成盤面や生成scriptは与えられません。盤面はあなた自身で設計してください。

画面:
- 通常のpair落下を操作できるManual Modeを作る。
- Challenge Modeではchallenge.jsonを読み、同じresolveのstepを順番にanimationする。
- 現在chain数、消去cell、次の盤面が視覚的に分かるようにする。
- 最終盤面が実際に空のときだけ「ALL CLEAR」を表示する。
- replay速度を変更できるようにする。
- 色以外に形や記号も併用し、色覚だけに依存しない表示にする。
- window.__LIGHTBENCH__ に reset、runChallenge、snapshot、log を公開する。runChallengeはanimation無効でも実行可能にしてください。
```
