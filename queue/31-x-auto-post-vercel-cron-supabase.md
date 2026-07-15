---
title: 'X(Twitter)自動投稿botの401/403エラー、原因はほぼこの5つ — Vercel Cron × Supabase × twitter-api-v2 運用で全部踏んだ'
tags:
  - TwitterAPI
  - Vercel
  - Supabase
  - Nextjs
  - 自動化
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

X(Twitter)の自動投稿botを作っていると、こんな状況に陥りがちです。

- ローカルでは投稿できたのに、Vercelにデプロイした途端 **401 Unauthorized** が返る
- Developer Portalの設定は合っているはずなのに、投稿だけ **403 Forbidden** で弾かれる
- エラーメッセージが素っ気なさすぎて、**どの環境変数が悪いのか**見当がつかない

私は Vercel Cron × Supabase × twitter-api-v2 という構成で自動投稿を運用していますが、立ち上げ時に認証まわりのエラーを一通り踏みました。振り返ると、原因はほぼ5パターンに集約されます。

この記事で分かること:

- Vercel Cron + Next.js Route Handler + Supabase + twitter-api-v2 の構成の全体像
- **401/403の原因5パターンと切り分け手順**（対応表つき）
- Cronエンドポイントを守る `CRON_SECRET` のBearer検証
- スレッド投稿（連投）の実装パターンと、監査ログ設計の教訓

なお、X API側の仕様（権限設定・字数カウント等）は**執筆時点**のものです。変更される可能性があるので、最終的には公式ドキュメントで確認してください。

---

## 構成の全体像

まず前提となる構成です。

```text
Vercel Cron（定時発火）
  └→ Next.js Route Handler（/api/cron/post）
       ├→ Supabase: scheduled_posts テーブルから投稿予定を取得
       ├→ twitter-api-v2 で X に投稿
       └→ Supabase: post_logs テーブルに結果を記録（監査ログ）
```

- **Vercel Cron**: `vercel.json` にスケジュールを書くだけで、指定パスを定時に叩いてくれる
- **scheduled_posts**: 「いつ・何を投稿するか」を貯めておくテーブル
- **post_logs**: 成功/失敗と生レスポンスを残す監査ログ（後述しますが、これが運用で一番効きます）

`vercel.json` はこの程度です。

```json
{
  "crons": [
    { "path": "/api/cron/post", "schedule": "0 3 * * *" }
  ]
}
```

構成自体はシンプルなのですが、**認証が絡む箇所が「X API」「Vercelの環境変数」「Cronエンドポイント自体」の3層ある**のがハマりどころです。

---

## エラー×原因の対応表

先に結論の表を置きます。私が踏んだ順ではなく、遭遇率が高そうな順です。

| # | 症状 | 原因 | 対処 |
|---|---|---|---|
| 1 | **403 Forbidden**（投稿時） | アプリ権限が Read のまま | Read and Write に変更 → **アクセストークンを再生成** |
| 2 | **401 Unauthorized** | 環境変数が古い/欠けている | 値を修正 → **再デプロイ**（変更だけでは反映されない） |
| 3 | 401 だが**どのキーが悪いか不明** | 切り分け手段がない | 先頭数文字だけ出す「マスクプレビュー」で特定 |
| 4 | エラーではないが**誰でもCronを叩ける** | エンドポイントが無防備 | `CRON_SECRET` + `Authorization: Bearer` 検証 |
| 5 | 投稿だけ失敗する（字数系エラー） | Xの字数カウント仕様と `length` の不一致 | UTF-16コードポイント/URL約23字換算で事前検証 |

以下、順番に掘っていきます。

---

## 1. 403 Forbidden — 権限変更後の「トークン再生成」を忘れている

X Developer Portal で作ったアプリは、デフォルトの権限設定が **Read** になっていることがあります。この状態で投稿（書き込み）を叩くと 403 が返ります。

対処は User authentication settings で **Read and Write** を設定することなのですが、ここに定番の罠があります。

**設定を変更しただけでは、既存のアクセストークンには反映されません。設定変更後にアクセストークン（Access Token and Secret）を再生成する必要があります。**

私もここで止まりました。「権限は Read and Write にした、なのに403」という状態は、ほぼこの再生成忘れです。Portal上の表示は Read and Write なのに、手元のトークンは Read 時代に発行されたもの、という食い違いが起きます。

チェックリストにするとこうです。

1. User authentication settings で Read and Write を設定したか
2. **その後に** Access Token and Secret を再生成したか
3. 再生成した新しい値を環境変数に反映したか（→次の401の話につながります）

---

## 2. 401 Unauthorized — Vercelの環境変数は「再デプロイするまで」反映されない

トークンを再生成したら、当然 Vercel の環境変数も新しい値に更新します。ここで2つ目の罠です。

**Vercelは、環境変数を変更しても、再デプロイするまで稼働中の関数には反映されません。**

ダッシュボードで値を書き換えて「直った」と思っても、動いているのは古い値を焼き込んだデプロイのままです。結果、いつまでも401が出続けます。

- 環境変数を変えたら、必ず **Redeploy**（または新しいデプロイをpush）する
- 「ローカルの `.env.local` では動くのに本番で401」も、まずこのパターンを疑う

環境変数の更新と再デプロイは**必ずセット**、と覚えておくのが安全です。

---

## 3. 401の切り分け術 — 「マスクプレビュー」でどのキーが悪いか特定する

401が出たとき本当に知りたいのは「**4つある認証情報のうち、どれが想定と違うのか**」です。しかし秘密情報なので、値をそのままログに出すわけにはいきません。

そこで、**先頭数文字と長さだけをログに出す**「マスクプレビュー」を仕込みます。

```typescript
// Log only the first few chars + length. NEVER log the full value.
function maskPreview(name: string, value: string | undefined): string {
  if (!value) return `${name}: (missing)`;
  return `${name}: ${value.slice(0, 4)}... (len=${value.length})`;
}

console.log(maskPreview('X_API_KEY', process.env.X_API_KEY));
console.log(maskPreview('X_API_SECRET', process.env.X_API_SECRET));
console.log(maskPreview('X_ACCESS_TOKEN', process.env.X_ACCESS_TOKEN));
console.log(maskPreview('X_ACCESS_SECRET', process.env.X_ACCESS_SECRET));
```

これをRoute Handlerの冒頭に一時的に入れてVercelのログを見ると、

- `(missing)` → そもそも環境変数が設定されていない（変数名のtypo含む）
- 先頭数文字が手元の正しい値と違う → 古い値が焼き込まれている（＝再デプロイ忘れ）
- 長さが明らかに違う → コピペミス（前後の空白や欠け）

が一目で分かります。**値全体は絶対にログへ出さない**こと。先頭4文字と長さだけでも切り分けには十分です。原因特定が済んだらこのログは消すか、デバッグフラグで無効化しておきます。

---

## 4. Cronエンドポイントの保護 — `CRON_SECRET` をBearerヘッダで検証する

`/api/cron/post` のようなエンドポイントは、URLさえ知られれば**誰でも叩けてしまいます**。自動投稿のエンドポイントが無防備だと、第三者に連打されて意図しない投稿やレート制限消費につながりかねません。

対処は、環境変数 `CRON_SECRET` を用意して、リクエストの `Authorization: Bearer` ヘッダを検証することです。**Vercel Cronは、`CRON_SECRET` を設定しておくと自動でこのヘッダを付けてリクエストしてくれます**（執筆時点の仕様です）。

```typescript
// app/api/cron/post/route.ts
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // ... fetch scheduled_posts, post to X, write post_logs
  return Response.json({ ok: true });
}
```

つまり実装側は「ヘッダを検証するだけ」でよく、Cron側の設定は不要です。手動でテストするときは、自分で同じヘッダを付けて叩きます。

なお、この検証を入れた後に自前のcurlで401が出たら、それはX API側の401ではなく**自分のBearer検証で弾かれている**だけ、という紛らわしさもあります。401がどの層から返っているのか（自前検証 / X API）をレスポンスボディやログで区別できるようにしておくと混乱しません。

---

## 5. 字数超過 — Xの字数は `length` では測れない

環境変数も権限も正しいのに特定の投稿だけ失敗する場合、**字数超過**を疑います。ここが地味に厄介で、Xの字数カウントはJavaScriptの `string.length` と一致しません（執筆時点の仕様です）。

- 字数は **UTF-16コードポイント**ベースの独自ルールでカウントされる
- **URLは実際の長さに関係なく、一律で約23字換算**される（t.co短縮のため）

つまり「`length` で数えて上限内だからOK」は成り立ちません。長いURLを含む投稿は想定より短く数えられる一方、絵文字などを含む投稿は `length` との差が出ます。

対処は、**投稿前に検証を挟む**ことです。ライブラリ（twitter-text系など）を使うか、少なくとも「URLを約23字に置き換えて数える」自前計算を入れておきます。

```typescript
// Rough pre-check: replace URLs with 23-char placeholder before counting
const URL_LENGTH = 23;

function estimateTweetLength(text: string): number {
  const urlPattern = /https?:\/\/\S+/g;
  const withoutUrls = text.replace(urlPattern, 'x'.repeat(URL_LENGTH));
  return [...withoutUrls].length; // count by code points
}
```

これはあくまで概算です。厳密にやるなら公式のカウント仕様に準拠したライブラリでの検証をおすすめしますが、「投稿予定テーブルに入れる時点で概算チェックして弾く」だけでも、Cron実行時の失敗はかなり減らせます。

---

## スレッド投稿（連投）の実装パターン

1ツイートに収まらない内容はスレッドにします。twitter-api-v2では、**直前のツイートIDを `reply.in_reply_to_tweet_id` に渡して繋いでいく**のが基本パターンです。

```typescript
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({
  appKey: process.env.X_API_KEY!,
  appSecret: process.env.X_API_SECRET!,
  accessToken: process.env.X_ACCESS_TOKEN!,
  accessSecret: process.env.X_ACCESS_SECRET!,
});

async function postThread(texts: string[]) {
  let previousId: string | undefined;

  for (const text of texts) {
    const { data } = await client.v2.tweet(
      text,
      previousId
        ? { reply: { in_reply_to_tweet_id: previousId } }
        : undefined,
    );
    previousId = data.id;
  }
}
```

ポイントは2つです。

- 1本目は通常投稿、2本目以降は**直前の投稿の `data.id`** を `in_reply_to_tweet_id` に渡す
- 途中で失敗すると「スレッドが千切れる」ので、**何本目まで成功したかをログに残す**（次の話につながります）

---

## 運用の教訓 — post_logs に「生レスポンス」を残しておく

最後に、運用して一番効いたと感じている設計の話です。

投稿結果は `post_logs` テーブルに、**成功/失敗のステータスと、APIの生レスポンス（またはエラー内容）ごと**記録しています。

これが効くのは、**自動投稿は「壊れてもすぐには気づけない」**からです。Cronは毎日黙って動くので、権限や環境変数が原因で失敗し始めても、Xのタイムラインを見に行かない限り分かりません。

post_logsに生レスポンスを残しておくと、

- 「**いつから壊れていたか**」がテーブルを遡るだけで特定できる
- 失敗時のエラー内容がそのまま残っているので、**403か401か、字数系か**の切り分けが即できる
- 「この日を境に403になっている → その頃トークンを触ったか？」と原因の当たりがつく

逆にログが「成功/失敗のフラグだけ」だと、後から原因を追う手がかりがありません。ストレージ的にはテキスト列が1つ増えるだけなので、**生レスポンスは必ず保存しておく**ことをおすすめします。

---

## まとめ

X自動投稿botの401/403は、ほぼこの5つに集約されます。

1. **403** → アプリ権限を Read and Write にして、**トークン再生成**まで忘れずに
2. **401** → 環境変数の更新は**再デプロイとセット**（変更だけでは反映されない）
3. 401の切り分けは**マスクプレビュー**（先頭数文字＋長さのみ。値全体はログに出さない）
4. Cronエンドポイントは **`CRON_SECRET` のBearer検証**で保護（Vercel Cronは自動でヘッダを付与）
5. 字数は `length` では測れない。**UTF-16コードポイント＋URL約23字換算**で事前検証

そして運用面では、**post_logs に生レスポンスを残す**こと。自動化は「動き始めた後に静かに壊れる」ので、後から時系列を追える監査ログが最大の保険になります。

同じ構成で詰まっている方の切り分け時間が、少しでも短くなれば幸いです。
