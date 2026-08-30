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

- Turn 1: S1〜S6を閉本で`正`/`誤`判定し、短いギャル口調の旅行説明へ落とし込む。
- Turn 2: 公式Fact Card F1〜F6を渡し、S1・S4・S6を含む誤りを意味内容まで訂正する。
- truth/訂正は決定的評価、自然さ・キャラクター・読みやすさは匿名experience評価に分離する。

## ぷよぷよ風・18連鎖全消し

- 候補自己申告ではなく`challenge.json`の70 cell盤面へ公開pairを実際に`dropPair`する。
- lock後72 cell、18 chain、各step 4 cell、最終0 cellをすべて必須とする。
- 色置換、左右鏡映、決定的random boardでengineを差分検査する。

## 3×3 ルービックキューブ

- move群の恒等性、色数、center、permutationを検査する。
- 公開1 seed、非公開3 seedを合法move logだけで完成させる。
- logの隣接stateをoracleで再計算し、solvedへの直接置換を排除する。

## Lander Pop

- 候補simを100 state/controlでoracleと比較する。
- 候補controllerは評価器のoracle sim内でsensorだけを渡して実行する。
- 候補のscenario生成器は使わず、封印した完全な`state + params`を入力する。
- 非公開scenarioの80%以上の安全着陸をHeadlineとし、time・fuel・各安全marginは合算せずraw値で公開する。

## Cohort

hidden fixtureとevaluatorは実行前にhash commitmentを作り、4課題を同一cohortで閉じた後にfixture本体と照合記録を公開する。公開後に追加するモデルは別cohortにし、未公開fixtureを更新する。モデルページは4課題が揃ったcohortを優先し、別cohortのrunを混在させない。

## 独立評価CLI

候補codeを実行するため、hostやPages workflowでは使わない。networkなし・書き捨て可能なsandbox内だけで次を実行する。fixtureとoracleは信頼済み親processが保持し、候補moduleは提出directoryだけを読めるNode permission processへ分離される。Lander Popのsimとcontrollerも互いに別processである。

```powershell
$env:LIGHTBENCH_ISOLATED = "1"
npm run evaluate -- <task-id> <submission/site> [fixture.json]
```

task-idは`color-cascade-18`、`prism-twist`、`lander-pop`。fixtureを省略した場合は公開qualification、指定した場合は次のtask別payloadを使う。

- Color Cascade: `{ "boards": [...], "pairs": [{"board": [...], "pair": {...}}] }`
- Prism Twist: `{ "seeds": [{"seed": 1, "length": 25}], "algorithms": [["R","U"]] }`
- Lander Pop: `{ "scenarios": [{"id": "scenario-1", "state": {...}, "params": {...}}], "physics": [{"state": {...}, "control": {...}, "params": {...}}] }`

CLIはheadline、logic、robustnessを別々に返す。候補UIの操作性・animation・視覚表現は録画を匿名化し、experience rubricで別評価する。ぷよぷよ風は丸い色ぷよ・6列盤・2個組、3×3キューブは標準6色・正方形ステッカー・濃色のcubie境界を満たさないrunを視覚比較の対象外にする。
