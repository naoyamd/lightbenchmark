# Coding Agent共通prompt

Prompt version: `CODE-1.1`

この本文と対象課題のpromptを改変せず連結して、Coding Agentへ1つのuser messageとして渡す。

```text
あなたは新規の隔離workspaceで動く自律Coding Agentです。与えられた仕様を満たす、ブラウザで動作する小さな作品を完成させてください。

実行条件:
- 作業時間は12分、最大24 agent stepです。
- ネットワーク、検索、package install、CDN、外部画像・音声・fontは利用できません。
- Node.js、Chromium、公開テストだけがあらかじめ用意されています。
- 編集できるのは submission/site/ 以下だけです。テストや評価器は変更しないでください。
- HTML/CSS/JavaScriptだけを使い、外部runtime dependencyを追加しないでください。
- submission/site/index.html から相対pathだけで起動できるようにしてください。
- 実装後は node public-tests.mjs を実行し、可能な範囲で失敗を修正してください。

重要:
- 成功状態、chain数、solved、landedを画面表示だけで偽装してはいけません。
- 既知のseed、URL、時刻、User-Agent、DOM検査に対する特別分岐を作ってはいけません。
- 表示、animation、判定、telemetryは、必須moduleが生成した実状態とevent logだけを根拠にしてください。DOMの文言や予定時間を判定の根拠にしてはいけません。
- 評価器は同等仕様の未知入力、fresh browser、独立oracleを使って再検証します。
- 状態配列やlogを外部へ返す場合はcopyを返し、任意の状態へteleportできる公開APIを作らないでください。
- 時間切れでも、動く部分を保存してください。

再演契約（public-v1）:
- 固定されたpublic-v1 scenarioを使い、乱数、現在時刻、frame時間、DOMの状態に結果を依存させないでください。reset後に同じ公開操作を繰り返すと、必須moduleの実内部状態、判定、event logが同じ順序・内容になるようにしてください。
- window.__LIGHTBENCH__.reset は進行中のsetTimeout、setInterval、requestAnimationFrame、CSS/Web Animationなどのtimer/animationを停止またはcancelし、古いcallbackが状態、表示、event logを更新できないようにして、public-v1の初期内部状態と空のevent logへ戻してください。
- 課題promptで指定する window.__LIGHTBENCH__ の runChallenge、scramble、play、run は、アニメーションを伴う公開操作としてPromiseを返してください。Promiseは必須moduleの最終状態を作るだけでなく、最後の表示animationまたは最終frameの描画まで終わってからresolveしてください。animationを無効にした場合も同じ実状態とevent logを確定し、最終表示への同期後にresolveしてください。
- event logは実際に起きた状態遷移だけを記録し、snapshot、log、telemetryと画面の成功表示・chain数・solved・landed・statusは、その内部状態とevent logから導出してください。外部へ返す配列・オブジェクトはcopyにしてください。

最後の回答は、作成ファイル、実行したテスト、未完了点だけを短く報告してください。
```
