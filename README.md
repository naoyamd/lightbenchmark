# LightBenchmark

LightBenchmarkは、小規模なAIモデルを「見て面白い」「成功・失敗が一目で分かる」4課題で比較する静的ベンチマークです。

- 8つのご当地知識を閉本で正誤判定し、Fact Cardを渡した後に訂正する日本語チャット
- 空盤面から配置を計画し、18連鎖して全消しする丸い色ぷよの落ちものゲーム
- 標準6色の3×3ルービックキューブ
- 順運動学・逆運動学・障害物回避・把持を行う2リンクロボットアーム仕分け

単一の総合点は作りません。課題達成、ロジック、未知入力への頑健性、見やすさ、token・費用・時間・サブエージェント使用量を別々に公開します。

## 現在含まれるもの

- `prompts/` — 全モデルへ渡すversion固定prompt
- `starters/` — Coding Agent workspaceへ置く公開テスト
- `evaluator/` — Node標準ライブラリだけの独立oracle
- `runs/` — append-onlyの実行記録
- `web/` — 結果サイトの静的source
- `scripts/build-site.mjs` — run検証と`dist/`生成

候補のHTML/CSS/JavaScriptは評価とは分離した観察用showcaseとして公開できます。モデル専用ページでは同じcohortの4課題を2×2で並べ、3つのlive showcaseを`sandbox="allow-scripts"`のopaque-origin iframeへ描画します。外側の課題ボタンで動かせるのは1件ずつです。主判定は候補画面ではなくtop-level run status、副評価は独立評価器のJSONだけを正とします。

## 必要環境

- Node.js 24以上
- 追加packageなし

```powershell
npm test
npm run build
npm run prompt -- prism-twist
```

生成された`dist/`を任意の静的serverで開けます。トップはモデル一覧で、各モデルの専用ページに4課題を固定順で掲載します。

```powershell
npm run dev
```

`http://127.0.0.1:4173/`で確認できます。build、test、local serverのいずれもnetworkやinstallを必要としません。

## ベンチマーク実行

1. `npm run prompt -- <task-id>`でroleとturnを含む完成payloadを取り出し、`npm run hash:prompts`で実際のmessage sequenceのSHA-256を記録する。
2. `npm run prepare -- work/<fresh-run-id>`でfresh bundleを作り、prompt・evaluator・cohort固有fixtureのhashを実行前に封印する。対象task directoryだけをbenchmark repositoryやoracleが存在しない使い捨てVM/containerへ転送する。
3. その隔離環境でnetworkなし、12分hard timeout、24 agent step、出力20,000 token、0.25 USD上限としてCoding Agentを1回実行する。runnerが強制できない上限は`observed-only`と記録し、hard制限として扱わない。
4. 候補artifactを公開テスト、権限制限した別processの非公開oracle、fresh Chromiumのbrowser smokeへ通す。fixtureは候補workspaceへ置かず、cohortの4実行が閉じるまで公開しない。
5. `docs/RUN_SPEC.md`に従って`runs/<run-id>/run.json`と任意のshowcaseを追加する。`runs/_example`のような`_`始まりの補助ディレクトリは公開ビルドから除外される。
6. `npm run check`後、`main`へ反映するとGitHub Pagesが更新される。

チャット課題は検索・groundingなしのfresh conversationで2ターン実行します。検索を無効化できないproviderは閉本結果と別cohortにしてください。

ローカルdebugではチャットも実装課題もCodexログイン認証を一時`CODEX_HOME`へ隔離して使います。チャットはread-onlyの空workspaceで同一sessionをresumeし、JSONLにtool callが1件でも出たら失敗にします。CLIではsystem/user roleがResponses APIと完全同値ではないため、これは`same-host-debug`であり正式結果には使えません。実装課題はprompt・公開テスト・空の提出先だけをrepo外の使い捨てdirectoryへ移し、JSONLと12分timeoutを保存します。

```powershell
npm run run:chat -- work/<run-id>/japanese-chat --model gpt-5.6-luna --effort max
npm run run:codex -- work/<run-id>/prism-twist --model gpt-5.6-luna --effort max
npm run run:codex -- work/<run-id>/robot-arm-sort --model gpt-5.6-luna --effort max
npm run smoke -- prism-twist work/<run-id>/prism-twist/submission/site
npm run finalize:debug -- work/<run-id>/prism-twist --run-id debug-<attempt>-prism-twist --cohort-id debug-<attempt>
```

Codex runnerはJSONLを実行中から逐次保存し、中断しても開始時刻と観測済み件数を残します。debug finalizerは既存runを上書きせず、封印済みhashを再照合して候補、fixture、browser smoke、評価、usageをappend-only recordへ確定します。評価器・評価harness・非公開testの参照痕跡は比較不能理由として記録します。

Coding課題の候補moduleは、必ずnetworkを切った使い捨て環境で評価します。CLIはfixtureとoracleを持つ信頼済み親processから、候補をNode permission model付きの別processで呼び出します。候補processが読めるのは提出directoryと公開RPC workerだけです。環境変数は外側のnetwork隔離を運用者が確認したことを示す誤実行防止gateです。

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
- モデルページは各課題の最新runを使い、cohortが混在する場合はカードごとに採用cohortを明示します。
- ハーネス調整中のrunは`runKind: debug`かつ`status: inconclusive`とし、正式結果へ混ぜません。
- live showcaseはUTF-8のHTML/CSS/JavaScript/JSON、合計2 MiB以下に限定し、CSP、path traversal、symlink、外部通信、worker、入れ子frameを拒否します。
- live showcaseは初期状態を同時に表示できますが、実行は1件だけです。別課題の実行時は前の課題を初期状態へ戻します。デモのmessageや成功演出はscoreへ反映しません。

## 権利・安全

課題として認識できる定番の盤面・配色・操作は必須ですが、公式logo、既存ゲームの画像・音声・固有キャラクターは使いません。

## License

MIT
