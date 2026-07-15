---
title: 'LINEで写真を送るとAIが見積もりを返すボットを作った — LINE Webhook「検証」ボタンの罠と本当の疎通確認方法'
tags:
  - LINEmessagingAPI
  - LINEBot
  - Claude
  - ngrok
  - AI
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

LINE Messaging APIでボットを作り始めると、こんな場面に出くわします。

- LINE Developersコンソールで Webhook の「検証」ボタンを押すと**成功**と出るのに、実機からメッセージを送ると**ボットが無反応**
- Webhook URLは合っているはず、コードも動くはず。なのに**どこが悪いのか切り分ける手段が分からない**
- 画像を受け取ってAIに渡したいのに、Webhookで届くイベントには**画像本体が入っていない**

この記事は、「LINEで写真を送ると、AIが内容を読み取って定型の見積もりテキストを返すボット」を個人開発したときの記録です。中でも一番時間を溶かした **Webhook「検証」ボタンの罠**と、**ngrokを使った機械的な疎通切り分け**を中心にまとめます。

**この記事で分かること**

- LINE Messaging API + Claude API（画像入力）で写真見積もりボットを作る全体構成
- 「検証は成功するのに本番で動かない」ときに真っ先に確認すべき設定
- ngrokのリクエストインスペクタで「LINE側の問題か、アプリ側の問題か」を機械的に切り分ける方法
- 署名検証・画像取得・応答時間制限など、実装の要点

なお、LINE側の仕様に関する記述は**執筆時点（2026年7月）**のものです。仕様は変わる可能性があるので、必ず[LINE Developersの公式ドキュメント](https://developers.line.biz/ja/docs/)で最新情報を確認してください。

## 全体構成

構成はシンプルです。ユーザーが写真を送ると、Webhookで受けた画像をClaude APIに渡し、読み取った内容を定型の見積もりテキストに整形してLINEに返します。

```text
[ユーザー]
   │ 写真を送信
   ▼
[LINE Platform]
   │ Webhook (POST)
   ▼
[自作サーバー (Node.js / ローカル開発時は ngrok 経由)]
   │ 1. 署名検証 (x-line-signature)
   │ 2. 画像を content エンドポイントから取得
   │ 3. base64 にして Claude API へ
   ▼
[Claude API (Sonnet系・画像入力)]
   │ 写真の内容を読み取り → 定型フォーマットに整形
   ▼
[自作サーバー] ── reply / push ──▶ [ユーザーに見積もりテキスト]
```

モデルはコスト重視でSonnet系を採用しました。「写真から内容を読み取って、決まったフォーマットの文章に整形する」という用途なら、画像理解と文章整形の品質はこれで十分でした。

## 最大のハマりポイント：「検証」ボタンは Webhook利用OFF でも成功する

先に結論です。

**LINE Developersコンソールの Webhook「検証」ボタンは、「Webhookの利用」トグルがOFFのままでも成功します。**

つまり「検証OK」＝「本番でメッセージが届く」ではありません。

私の場合、「検証」成功 → 実機で無反応 → コード側を延々デバッグ、と時間を溶かした末に、コンソールの「Webhookの利用」トグルがOFFのままだったことに気づきました。

「検証」ボタンは設定したURLへの疎通を確認するものであって、**実際のメッセージイベントが配送される状態か**までは保証してくれません（執筆時点の挙動です）。「検証は成功するのに実メッセージに反応しない」場合は、コードを疑う前に、まず**「Webhookの利用」トグルがONか**を確認してください。

## ngrokインスペクタで「LINE側か、アプリ側か」を機械的に切り分ける

トグルを直しても動かないとき、次に必要なのは「そもそもLINEからWebhookが届いているのか」の事実確認です。ローカル開発でngrokを使っているなら、リクエスト単位で確認できます。ngrok起動中にブラウザで次のURLを開くだけです。

```text
http://127.0.0.1:4040
```

これはngrokのリクエストインスペクタで、トンネルを通ったHTTPリクエストが一覧表示されます。実機からメッセージを送った直後にここを見れば、切り分けは機械的に終わります。

| インスペクタの表示 | 問題の所在 | 確認すること |
|---|---|---|
| リクエストが**来ていない** | LINE側の設定 | 「Webhookの利用」トグル、Webhook URLの誤り（httpsか、パスまで合っているか） |
| リクエストが**来ている**が応答がエラー | アプリ側 | 署名検証の失敗、ルーティング、例外でクラッシュしていないか |
| リクエストが来て**200を返している**のに返信がない | アプリ側のロジック | 返信処理（reply/push）の実装、APIエラーのログ |

「届いていなければLINE側、届いていればアプリ側」。この一言だけで、当てずっぽうのデバッグから抜け出せます。

## 実装の要点

### 1. 署名検証（x-line-signature）

Webhookのリクエストが本当にLINEから来たものかを、`x-line-signature`ヘッダーで検証します。チャネルシークレットを鍵としたHMAC-SHA256で**生のリクエストボディ**を署名し、ヘッダーの値と比較します。

ここで注意したいのは、`express.json()`などでパース済みのボディから再構築したJSONではなく、**受信したままの生のボディ**で計算することです。JSONの再シリアライズでバイト列が変わると署名が一致しなくなります。

```javascript
import express from "express";
import crypto from "crypto";

const app = express();

// 署名検証には生ボディが必要なので raw で受ける
app.post("/webhook", express.raw({ type: "*/*" }), (req, res) => {
  const signature = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(req.body) // 生のBuffer
    .digest("base64");

  if (signature !== req.headers["x-line-signature"]) {
    return res.status(401).end();
  }

  // 先に200を返してから重い処理へ（後述の応答時間対策）
  res.status(200).end();

  const { events } = JSON.parse(req.body.toString("utf8"));
  for (const event of events ?? []) {
    handleEvent(event).catch(console.error);
  }
});
```

チャネルシークレットやアクセストークンは環境変数で管理し、コードやリポジトリに直接書かないでください。

### 2. 画像はcontentエンドポイントから取得してbase64でClaudeへ

Webhookで届く画像メッセージイベントには、画像の**メタ情報（messageId等）しか入っていません**。画像本体は、messageIdを使ってLINEのコンテンツ取得エンドポイントから別途ダウンロードします。

```javascript
async function fetchImageAsBase64(messageId) {
  const res = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    },
  );
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    base64: buf.toString("base64"),
    mediaType: res.headers.get("content-type") ?? "image/jpeg",
  };
}
```

取得した画像をbase64にして、Claude APIに画像ブロックとして渡します。

```javascript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY を環境変数から読む

async function estimateFromImage(base64, mediaType) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5", // コスト重視でSonnet系を採用
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          { type: "text", text: ESTIMATE_PROMPT },
        ],
      },
    ],
  });
  return response.content.find((b) => b.type === "text")?.text ?? "";
}
```

### 3. 応答時間の制限とreply tokenの扱い

Webhookは受信後すみやかに200を返すことが求められます（執筆時点で確認した情報では目安5秒。最新の値は公式ドキュメントを確認してください）。また、返信に使うreply tokenには有効期限があります。

画像取得→AI呼び出し→整形は数秒かかることがあるため、素直に「処理してからreply」と書くとタイムアウトやreply token失効を踏みます。定番の対策は次のパターンです。

1. Webhook受信時は**先に200を返す**（上のコード例の形）
2. 重い処理はバックグラウンドで実行
3. 処理完了後、reply tokenではなく**push message**でユーザーに送信する

reply tokenの期限内に確実に終わる軽い処理ならreplyで問題ありませんが、AI呼び出しを挟むボットではpush前提の設計にしておくほうが安全でした。

## 応答フォーマットはプロンプトで固定すると実用に耐える

AIの出力をそのままユーザーに返すと、毎回文体や構成が揺れて「サービスの応答」としては使いにくくなります。プロンプトで**出力フォーマットを固定**すると一気に実用的になりました。

```text
あなたは見積もり作成アシスタントです。
送られた写真から確認できる内容をもとに、必ず次のフォーマットで出力してください。

【お見積もり（概算・参考値）】
■ 写真から確認できた内容
- （箇条書き）
■ 想定される作業・項目
- （箇条書き）
■ 概算金額
- （項目ごとの概算）

※本内容は写真から自動生成した概算・参考値です。
　正式なお見積もりは、詳細確認のうえ別途ご案内します。

写真から判断できない点は、推測で断定せず「要確認」と明記してください。
```

もう一つ、正直に書いておきたい設計判断があります。**金額の正確性はAIでは保証できません**。写真1枚から読み取れる情報には限界があり、モデルがもっともらしい数字を出すリスクもあります。そのため最初から「概算・参考値を返すもの」と割り切り、応答テキスト自体に注意書きを必ず含める設計にしました。「AIが正式見積もりを出す」のではなく「一次回答を自動化し、正式見積もりは人間が出す」という位置づけです。

## まとめ

- 構成は「LINE Webhook → 画像取得 → Claude API（Sonnet系）→ 定型テキストで返信」。画像理解＋文章整形ならSonnet系で十分だった
- **「検証」ボタンの成功は「Webhookの利用」トグルON を意味しない**。検証OKなのに無反応なら、まずトグルを確認する
- ngrokのリクエストインスペクタ（`http://127.0.0.1:4040`）を見れば、「LINEから届いていない＝LINE側設定」「届いている＝アプリ側」と機械的に切り分けられる
- 署名検証は**生ボディ**でHMAC-SHA256、画像はcontentエンドポイントから別途取得、重い処理は**先に200を返してpushで返信**
- 出力フォーマットはプロンプトで固定し、金額は「概算・参考値」と明記する設計にする

LINE側の仕様（検証ボタンの挙動・応答時間・エンドポイント）は執筆時点の情報です。実装前に[公式ドキュメント](https://developers.line.biz/ja/docs/messaging-api/)で最新仕様を確認してください。同じところでハマっている方の時間が節約できれば幸いです。
