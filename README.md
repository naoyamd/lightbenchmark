# LightBenchmark

LLMの4課題を、モデルごとに1ページで比較するベンチマーク。実行記録は追記で保存し、GitHub Pagesで閲覧できます。

- **日本語**：「ギャルっぽく糸島を紹介して」への返答を全文表示。自然さ・ギャル口調・事実性は人が別々に評価。
- **18連鎖**：空盤面から35組を積み、最後の1組で18連鎖・72個全消し。モデルの計画・配置・消去ロジックを独立検証。
- **3Dキューブ**：毎回25手のスクランブルを生成。解く側には状態だけを渡し、各手の論理と回転アニメーションも検証。ドラッグで六面を確認できます。
- **ロボットアーム**：重力・接触・摩擦が働く3関節アームを制御。中→小→大に積み、指を離して3秒安定させます。

外観・操作・物理環境は共通、解法と制御はモデルの提出コードです。総合点は作らず、達成項目、失敗理由、token、時間、取得できた費用を表示します。参考実装をモデルの出力として掲載しません。

## セットアップ

Node.js 24以上。

```sh
npm ci
npm run check
npm run dev
```

ローカル表示は `http://127.0.0.1:4173/`。公開先は [GitHub Pages](https://naoyamd.github.io/lightbenchmark/)。

## モデルを比較する

全モデルで共通の条件ファイルを作り、表示されたパスを各実行へ渡します。1モデルにつき4回の新規会話、コード課題は同じ3条件で検証します。

```sh
npm run benchmark:cohort
npm run benchmark:run -- --model deepseek-v4-flash --cohort results/cohorts/<id>.json
npm run benchmark:run -- --model mimo-v2.5 --cohort results/cohorts/<id>.json
npm run check
```

OpenCode Goは `OPENCODE_GO_API_KEY`、またはOpenCode CLIに保存済みのGo認証を使います。キーはご自身の端末で設定し、リポジトリへ保存しないでください。Goの公式APIに直接接続するため、個人のOpenCode設定・AGENTS.md・ツール・参考解法をモデルへ渡しません。Goの利用枠・追加料金はアカウント設定に従います。自動リトライや自動チャージは行いません。

任意の互換APIには `LIGHTBENCH_API_KEY` と `LIGHTBENCH_BASE_URL` を設定します。

```sh
npm run benchmark:run -- --provider compatible --model your-model-id --cohort results/cohorts/<id>.json
```

`--protocol chat|messages|responses` でAPI形式を選択できます。Goの代表的なモデルは自動選択します。モデルIDは `opencode models opencode-go --refresh` で確認してください。未対応の場合は失敗理由を記録し、別モデルへ勝手に置き換えません。

## 保存と日本語の評価

`results/runs/<実行ID>/` に要求本文、返答原文、提出コード、usage、各条件の判定と再生ログを保存します。既存記録は上書きせず、取得できない費用やtokenは `null`。生成時間と評価器の実行時間は別々に記録します。

APIの返答は評価を始める前に `*-response.json` へ保存し、各条件の結果も逐次保存します。途中で停止しても、受け取り済みの回答と完了した評価は残ります。

日本語カードの「日本語を評価」で評価JSONを保存し、取り込めます。

```sh
node platform/reviews.mjs path/to/review.json
npm run build
```

自然さ・ギャル口調・事実性を各1〜5で評価し、理由を必ず残します。未評価を0点にはしません。

ブラウザの「初期化」は提出コードを新しいseedで実行します。保存済み成績へは上書きしません。モデルを切り替えても再実行seedを保ち、同じ条件で動かします。

## 評価と隔離

候補コードはQuickJS/WASMの独立した環境で動かし、ホストのファイル、ネットワーク、DOM、モジュール読込を公開しません。メモリ64MiB、関数呼出し3秒、外側のworkerに60秒の上限があります。ブラウザも同じ評価器を使用します。

キューブのソルバーは新しい実行環境で状態だけを受け取り、生成履歴を受け取りません。独立生成した未知の盤面も試します。面回転は候補の軸・層・途中角度を共通描画へ接続します。アームは速度指令と指の開き幅だけを受け取り、箱の位置や成功判定を変更できません。

APIリクエスト上限4分と18,000出力tokenを指定し、終了理由とusageを保存します。料金自体をハーネスから強制停止する機能はないため、利用枠・請求上限はプロバイダー側で設定してください。

仕様・プロンプトは [platform/prompts.mjs](platform/prompts.mjs)、設計は [docs/PLATFORM_V2.md](docs/PLATFORM_V2.md)。`platform/reference/` は評価器の動作確認用で、モデルへの要求本文には含めません。

## 公開

```sh
npm run check
git add platform results package.json package-lock.json README.md docs .github scripts
git commit -m "Add benchmark results"
git push origin main
```

Pages workflowが検査・ビルド・公開を行います。APIキーはGitHub Actionsへ渡しません。APIを呼ぶのはローカルの実行CLIだけです。

旧実測は `/archive/` から閲覧できます。旧仕様の `prompts/`・`starters/`・`runs/` と新仕様は互換ではなく、成績を混ぜません。[旧手順](docs/LEGACY.md)も保存しています。

## ライセンス

MIT。Planck.jsとQuickJSのライセンスも配布物に同梱します。既存ゲームの画像・音声・ロゴは使用していません。
