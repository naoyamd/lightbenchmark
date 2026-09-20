# 外部で生成した回答を取り込む

この経路はLLM APIを呼びません。認証情報も読みません。モデルの呼び出しを別の環境や作業で行い、4課題の回答を評価・保存・公開するために使います。

## 1. 比較条件を作る

```sh
npm run benchmark:cohort
```

出力された `results/cohorts/<id>.json` の `prompts` が4課題の要求本文です。`system` と `user` をそのまま各モデルへ渡し、課題ごとに新しい会話を使います。`limits` に出力・時間制限、`conditionHash` に条件の識別子があります。seedや参考実装はモデルへ渡しません。

## 2. 回答JSONを用意する

```json
{
  "model": "モデルID",
  "provider": "opencode-go",
  "conditionHash": "cohortファイルのconditionHash",
  "tasks": {
    "chat": { "text": "モデルが返した紹介文の原文" },
    "puyo": { "text": "モデルが返したJavaScriptの全文" },
    "cube": { "text": "モデルが返したJavaScriptの全文" },
    "arm": { "text": "モデルが返したJavaScriptの全文" }
  }
}
```

回答の本文は添削せずに保存します。コードは単一のコードフェンスで囲まれていても取り込めます。各課題のオブジェクトには、取得できた場合だけ次を追加できます。

```json
{
  "text": "回答原文",
  "modelReturned": "APIが返した実モデルID",
  "responseId": "APIの応答ID",
  "finishReason": "stop",
  "durationMs": 12000,
  "usage": {
    "inputTokens": 1000,
    "outputTokens": 3000,
    "cachedTokens": null,
    "reasoningTokens": null,
    "totalTokens": 4000,
    "costUsd": null
  }
}
```

不明な値は省略または `null`。費用やtokenを推測で0にしないでください。APIキー、HTTP認証ヘッダー、個人の設定は入れません。

## 3. 採点・記録する

```sh
npm run benchmark:import -- --responses work/outputs-model-a.json --cohort results/cohorts/<id>.json
npm run build
npm run dev
```

取り込み前に全4課題の形式と条件hashを検証し、その後で隔離した環境でコードを実行します。結果は `results/runs/<新しいID>/` へ追記。元の回答、条件ごとの判定、再生ログを保存します。同じJSONを再度取り込んでも過去の記録は上書きしません。

外部生成はプラットフォームが生成経路を観測していないため、画面では「生成条件は申告」と表示します。同じ条件hashに加え、生成方法も揃えて比較してください。日本語の人手評価はカードの「日本語を評価」からJSONを保存し、`node platform/reviews.mjs <評価JSON>` で追加できます。

## 4. 公開する

`npm run check` を実行し、`results/` の記録と条件ファイルをコミットしてmainへ反映します。GitHub Pagesが静的サイトを更新します。公開前に回答に秘密情報が含まれていないことを確認してください。
