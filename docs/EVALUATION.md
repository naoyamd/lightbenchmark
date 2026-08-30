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

- Turn 1: S1〜S8を閉本で`正`/`誤`判定し、短いギャル口調の旅行説明へ落とし込む。
- Turn 2: Fact Card F1〜F8を渡し、S1・S4・S6・S8を含む誤りを意味内容まで訂正する。
- truth/訂正は決定的評価、自然さ・キャラクター・読みやすさは匿名experience評価に分離する。

## ぷよぷよ風・18連鎖全消し

- 候補の`planChallenge(goal, seed)`が空盤面から35組を合法配置し、途中消去なしで70 cellのgoalを組む。
- 36組目のtrigger後72 cell、18 chain、各step 4 cell、最終0 cellをすべて独立oracleで必須とする。
- 未知seed、色置換、左右鏡映、決定的random boardでplannerとengineを差分検査する。

## 3×3 ルービックキューブ

- move群の恒等性、色数、center、permutationを検査する。
- 公開1 seed、非公開3 seedを合法move logだけで完成させる。
- logの隣接stateをoracleで再計算し、solvedへの直接置換を排除する。

## 2リンク・ロボットアーム仕分け

- FK/IKを数値差分し、未知scenarioのkeyframe列を独立simulatorで再生する。
- 関節limit・速度、地面、両linkと障害物、把持中clearanceを連続補間上で検査する。
- 荷物はtool近傍でだけ把持でき、対応target近傍でだけ搬送完了とする。3個すべての実搬送をHeadlineにする。

## Cohort

hidden fixtureとevaluatorは実行前にhash commitmentを作り、各runのcohortとfixture本体の照合記録を公開する。公開後に追加するモデルは別cohortにし、未公開fixtureを更新する。ショーケース用のモデルページは各課題の最新runを並べ、cohortが混在する場合は採用cohortを明示する。正式比較では同一cohortのrunだけを使う。

## 独立評価CLI

候補codeを実行するため、hostやPages workflowでは使わない。networkなし・書き捨て可能なsandbox内だけで次を実行する。fixtureとoracleは信頼済み親processが保持し、候補moduleは提出directoryだけを読めるNode permission processへ分離される。

```powershell
$env:LIGHTBENCH_ISOLATED = "1"
npm run evaluate -- <task-id> <submission/site> [fixture.json]
```

task-idは`color-cascade-18`、`prism-twist`、`robot-arm-sort`。fixtureを省略した場合は公開qualification、指定した場合は次のtask別payloadを使う。

- Color Cascade: `{ "planCases": [{"goalSeed": 1, "planSeed": 2}], "boards": [...], "pairs": [{"board": [...], "pair": {...}}] }`
- Prism Twist: `{ "seeds": [{"seed": 1, "length": 25}], "algorithms": [["R","U"]] }`
- Robot Arm Sort: `{ "scenarios": [{"id": "scenario-1", "spec": {...}, "obstacles": [...], "items": [...]}] }`

CLIはheadline、logic、robustnessを別々に返す。候補UIの操作性・animation・視覚表現は録画を匿名化し、experience rubricで別評価する。ぷよぷよ風は丸い色ぷよ・6列盤・2個組、3×3キューブは標準6色・正方形ステッカー・濃色のcubie境界を満たさないrunを視覚比較の対象外にする。
