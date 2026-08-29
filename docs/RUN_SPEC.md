# Run record specification

`runs/<run-id>/run.json`は実行時に確認できた事実を保存するappend-only recordである。公開後にモデル名、token、prompt versionなどを訂正する場合は、元runを残して新attemptを作る。`runKind`は正式比較なら`official`、ハーネス調整や設定確認なら`debug`とする。debug runは必ず`inconclusive`で、正式結果へ昇格させない。

## 必須の実行情報

- `model`: 表示名、provider、正確なmodel ID、revision、reasoning設定。
- `execution`: timezone offset付きISO 8601の開始・終了、表示timezone、duration、agent step、tool call、終了理由、`autonomous`/`assisted` lane、実際のharness、候補workspaceの隔離状態。
- `usage.root`: root agentのinput/output/cached/reasoning/total tokenと費用。
- `usage.subagents`: subagent全体の同じ内訳。
- `usage.total`: rootとsubagentを一度ずつ足した請求対象の内訳。
- `agents`: spawned、completed、failed、maxConcurrentと、各agentの役割・model・token・時間・status。
- `interventions`: 人手修正、再prompt、依存追加など。なければ空配列。
- `artifacts`: 任意の画像・動画。`{kind,path,label}`を列挙し、pathはrun directory内の相対pathだけにする。
- `showcase`: 任意の実動表示。coding課題は`{kind:"live",entry:"showcase/index.html",protocol:"LIGHTBENCH-1",scenario:"public-v1"}`、chat課題は表示するUTF-8 textを`turns`へ列挙する。未取得・不正・未完成なら`null`とし、理由を`evaluation.showcase.reason`へ残す。
- `versions`: prompt、starter、evaluator、fixtureのversionとSHA-256。
- `evaluation`: headline、logic、robustness、experience、resources。

rootはsubagent数に含めない。model表示名・provider・正確なmodel ID、実行日時、subagent数はrunnerが必ず記録する。providerが返さないtokenや費用は`0`ではなく`null`とし、`costStatus`を`unavailable`にする。root/subagent/totalがすべて既知の値は、totalが前2者の和でなければbuildを拒否する。

subagentの`spawned`だけをrunnerが確実に観測できたdebug runでは、`completed`、`failed`、`maxConcurrent`、`items`を`null`にしてよい。推測値を埋めない。official runでは従来どおり全項目を必須とする。

statusは`pass`、`partial`、`candidate-fail`、`infra-error`、`inconclusive`のいずれか。実行laneは`autonomous`または`assisted`とする。正式runでは時刻とdurationを必須とし、相互差は1秒以内に一致させる。Coding課題の`execution.isolation`は`isolated-candidate-workspace`として、候補へbenchmark repository、oracle、参照実装、過去出力を読ませない。閉本chatは`tools-disabled-api`とする。ローカルrepoと同じhostで走らせたagent試行は`same-host-debug`であり、debug runだけに使える。debug runだけは計測欠落を`null`で公開できる。

ローカルCodex debug runnerも候補をrepo外の使い捨てdirectoryと、認証情報だけを持つ一時`CODEX_HOME`で実行し、prompt、公開test、提出先以外をstageしない。JSONLに評価器、評価harness、非公開testへの参照痕跡があれば`execution.benchmarkRepositoryExposure`へ、global AGENTSやユーザーskillへの参照痕跡があれば`execution.externalContextExposure`へ記録し、必ずcomparability blockerにする。この措置は誤露出を防ぐためのもので、同一host runを正式隔離へ昇格させるものではない。

公開galleryの動画・画像はrun directoryからの相対pathだけを使用する。絶対URL、`..`、symlink、実体のないfile、種別と拡張子の不一致は公開buildで拒否する。

live showcaseだけは候補HTML/CSS/JavaScriptを公開できる。UTF-8の`.html`、`.css`、`.js`、`.mjs`、`.json`に限定し、合計2 MiB以下、symlink・path traversal・`base`要素・候補独自CSPを拒否する。build時に信頼済みCSPとbridgeを注入し、公開ページは`sandbox="allow-scripts"`だけを持つopaque-origin iframeへ初期状態まで自動mountする。課題ボタンは準備済み状態から公開操作だけを実行し、同時実行は1件に限定する。別課題へ切り替えると前のshowcaseを新しいiframeの初期状態へ戻す。showcase内の表示やmessageは観察用であり、scoreは独立評価器の記録だけを正とする。

`execution.limits`には各budgetが`hard`か`observed-only`かを記録する。強制できない24 agent stepや20,000 output tokenをhard制限として表示してはならず、超過runは正式結果にしない。
