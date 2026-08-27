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
- `versions`: prompt、starter、evaluator、fixtureのversionとSHA-256。
- `evaluation`: headline、logic、robustness、experience、resources。

rootはsubagent数に含めない。model表示名・provider・正確なmodel ID、実行日時、subagent数はrunnerが必ず記録する。providerが返さないtokenや費用は`0`ではなく`null`とし、`costStatus`を`unavailable`にする。root/subagent/totalがすべて既知の値は、totalが前2者の和でなければbuildを拒否する。

statusは`pass`、`partial`、`candidate-fail`、`infra-error`、`inconclusive`のいずれか。実行laneは`autonomous`または`assisted`とする。正式runでは時刻とdurationを必須とし、相互差は1秒以内に一致させる。Coding課題の`execution.isolation`は`isolated-candidate-workspace`として、候補へbenchmark repository、oracle、参照実装、過去出力を読ませない。閉本chatは`tools-disabled-api`とする。ローカルrepoと同じhostで走らせたagent試行は`same-host-debug`であり、debug runだけに使える。debug runだけは計測欠落を`null`で公開できる。

公開galleryの動画・画像はrun directoryからの相対pathだけを使用する。絶対URL、`..`、symlink、実体のないfile、種別と拡張子の不一致は公開buildで拒否する。候補HTML/JavaScriptはartifactとして配信しない。
