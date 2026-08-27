# LightBenchmark

LightBenchmarkは、小規模なAIモデルを「見て面白い」「成功・失敗が一目で分かる」4課題で比較する静的ベンチマークです。

- 閉本の日本語チャットと、公式情報を渡した後の訂正
- 18連鎖して全消しするColor Cascade
- 実回転で完成する3D twisty puzzle
- 観測値から自動制御する垂直着陸toy simulation

単一の総合点は作りません。課題達成、ロジック、未知入力への頑健性、見やすさ、token・費用・時間・サブエージェント使用量を別々に公開します。

## 現在含まれるもの

- `prompts/` — 全モデルへ渡すversion固定prompt
- `starters/` — Coding Agent workspaceへ置く公開テスト
- `evaluator/` — Node標準ライブラリだけの独立oracle
- `runs/` — append-onlyの実行記録
- `web/` — 結果サイトの静的source
- `scripts/build-site.mjs` — run検証と`dist/`生成

候補のJavaScriptはGitHub Pages workflowで実行しません。隔離環境で検証して生成したJSON・画像・動画だけを公開対象にします。

## 必要環境

- Node.js 22以上
- 追加packageなし

```powershell
npm test
npm run build
npm run prompt -- prism-twist
```

生成された`dist/`を任意の静的serverで開けます。

```powershell
npm run dev
```

`http://127.0.0.1:4173/`で確認できます。build、test、local serverのいずれもnetworkやinstallを必要としません。

## ベンチマーク実行

1. `npm run prompt -- <task-id>`でroleとturnを含む完成payloadを取り出し、`npm run hash:prompts`で実際のmessage sequenceのSHA-256を記録する。
2. `npm run prepare -- work/<fresh-run-id>`でfresh bundleを作り、対象task directoryだけをbenchmark repositoryやoracleが存在しない使い捨てVM/containerへ転送する。
3. その隔離環境でnetworkなし、12分、24 agent step、出力20,000 token、0.25 USD上限としてCoding Agentを1回実行する。
4. 候補artifactを隔離環境で公開テストと非公開oracleへ通す。非公開fixtureは信頼済み親processだけが読み、候補は権限制限した別processで実行する。fixtureは公開repositoryや候補workspaceへ置かない。
5. `docs/RUN_SPEC.md`に従って`runs/<run-id>/run.json`と任意の録画を追加する。`runs/_example`のような`_`始まりの補助ディレクトリは公開ビルドから除外される。
6. `npm run check`後、`main`へ反映するとGitHub Pagesが更新される。

チャット課題はtoolをAPIへ渡さず、検索・groundingを無効にしたfresh conversationで2ターン実行します。検索を無効化できないproviderは閉本結果と別cohortにしてください。

OpenAIのチャット課題は`OPENAI_API_KEY`を環境変数だけで渡し、次でsystem/user role、tools 0件、時刻、usageを自動記録できます。実装課題のローカルCodex laneも同様にJSONLと12分timeoutを保存しますが、同じhostからrepoを読めるため常に`same-host-debug`かつ正式結果には使えません。

```powershell
npm run run:chat -- work/<run-id>/japanese-chat --model gpt-5.6-luna --effort max
npm run run:codex -- work/<run-id>/prism-twist --model gpt-5.6-luna --effort max
```

Coding課題の候補moduleは、必ずnetworkを切った使い捨て環境で評価します。CLIはfixtureとoracleを持つ信頼済み親processから、候補をNode permission model付きの別processで呼び出します。候補processが読めるのは提出directoryと公開RPC workerだけで、Lander Popのsimとcontrollerも別processです。環境変数は外側のnetwork隔離を運用者が確認したことを示す誤実行防止gateです。

```powershell
$env:LIGHTBENCH_ISOLATED = "1"
npm run evaluate -- prism-twist C:\isolated\submission\site C:\sealed\fixture.json
```

第3引数を省くと公開qualification caseだけを使います。blind比較ではcohortごとの未公開fixtureを第3引数へ渡し、出力JSONを`run.json`の`evaluation`へ保存してください。

## 公開方針

- 1モデル1回を基本とし、`n=1 showcase`と表示します。
- 後から修正した成果は同じrunを上書きせず、新しいattemptにします。
- providerが返さないtokenや費用は推測せず`null`で記録します。
- rootとsubagentのusageを分け、合計時に二重計上しません。
- 人手修正や再指示は`assisted`として別表示します。
- 新しいモデルを公開後に追加する場合は、新しいhidden fixtureを持つ別cohortにします。
- ハーネス調整中のrunは`runKind: debug`かつ`status: inconclusive`とし、正式結果へ混ぜません。

## 権利・安全

公開名とvisualはgenericな独自作品とし、既存ゲーム、企業、ロケットの名称・logo・画像・音声を使いません。Lander Popは教育用toy simulationであり、実機制御用途ではありません。

## License

MIT
