# Evaluation protocol

## 共通

1回の生成artifactへ、公開qualificationと非公開blind retestを順番に適用する。非公開評価のためにモデルを再度呼び出さない。

- `headline`: 課題固有の見せ場を達成したか。
- `logic`: 独立oracleと一致したか。
- `robustness`: 未知seed・変形入力で維持できたか。
- `experience`: 匿名化した人手評価。clarity、delight、trustを各0〜4。
- `resources`: token、費用、時間、tool call、subagent、介入。

これらを合算した総合点は作らない。機械判定の失敗を人手評価で相殺しない。

## 日本語チャット

- Turn 1: 正しい原子事実数、重大誤り、未確認断定、文字数、絵文字、4項目充足。
- Turn 2: F1を含む4 Fact以上、訂正認識、カード外主張、形式。
- Headline: Turn 1に重大誤りなし・正しい事実5個以上、Turn 2でF1を含む4 Fact以上、形式違反なし。

## Color Cascade 18

- 候補自己申告ではなく`challenge.json`をreference resolverで評価する。
- 72 cell、18 chain、各step 4 cell、最終0 cellをすべて必須とする。
- 色置換、左右鏡映、決定的random boardでengineを差分検査する。

## Prism Twist 3×3

- move群の恒等性、色数、center、permutationを検査する。
- 公開1 seed、非公開3 seedを合法move logだけで完成させる。
- logの隣接stateをoracleで再計算し、solvedへの直接置換を排除する。

## Lander Pop

- 候補simを100 state/controlでoracleと比較する。
- 候補controllerは評価器のoracle sim内でsensorだけを渡して実行する。
- 公開scenario成功、非公開5件中4件以上の安全着陸をHeadlineとする。

## Cohort

hidden fixtureは実行前にhash commitmentを作り、cohort封印後に公開する。公開後に追加するモデルは別cohortにし、未公開fixtureを更新する。

## 独立評価CLI

候補codeを実行するため、hostやPages workflowでは使わない。networkなし・書き捨て可能なsandbox内だけで次を実行する。fixtureとoracleは信頼済み親processが保持し、候補moduleは提出directoryだけを読めるNode permission processへ分離される。Lander Popのsimとcontrollerも互いに別processである。

```powershell
$env:LIGHTBENCH_ISOLATED = "1"
npm run evaluate -- <task-id> <submission/site> [fixture.json]
```

task-idは`color-cascade-18`、`prism-twist`、`lander-pop`。fixtureを省略した場合は公開qualification、指定した場合は次のtask別payloadを使う。

- Color Cascade: `{ "boards": [...], "pairs": [{"board": [...], "pair": {...}}] }`
- Prism Twist: `{ "seeds": [{"seed": 1, "length": 25}], "algorithms": [["R","U"]] }`
- Lander Pop: `{ "scenarios": [{"seed": 1, "overrides": {...}}], "physics": [{"state": {...}, "control": {...}, "params": {...}}] }`

CLIはheadline、logic、robustnessを別々に返す。候補UIの操作性・animation・視覚表現は録画を匿名化し、experience rubricで別評価する。
