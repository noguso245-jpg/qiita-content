---
title: Claude Codeのトークンを「測ってから削る」— /usage で何が見えて、どこを削るか
tags:
  - AI
  - 個人開発
  - トークン
  - 生成AI
  - ClaudeCode
private: false
updated_at: '2026-07-01T16:18:47+09:00'
id: 14edd7448e452795798c
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

> 📦 この記事で出てくる「コンテキストを軽くする」スキル（CLAUDE.md設計など）は、無料リポ（GitHub・CC BY 4.0）で配布しています。すぐ試したい方は記事末の「今すぐ試す」へ。

Claude Codeを毎日使っていると、こんな引っかかりが出てきます。

- 同じ作業をしているはずなのに、セッションによってやたらコンテキストが膨らむ気がする
- MCPサーバーやスキルを盛りまくった結果、何が一番「重い」のか分からない
- なんとなく `/clear` や `/compact` を打っているが、効いているのか確信が持てない

トークン削減の記事は世にたくさんありますが、その多くが**「まず削る」から始めます**。順番が逆です。最適化は「測定 → 削減」が鉄則で、Claude Code には**測るための公式コマンドが用意されています**。それが `/usage` です。

この記事は「何を減らすか」の前段、**「今いくら使っていて、どこが重いのかを見る」**フェーズを、公式ドキュメントに書いてある事実だけで解説します。推測仕様は書きません。出典は記事末にまとめます。

---

## まず `/usage` を打つと何が見えるか

Claude Code のセッション中に `/usage` と入力するだけです。設定もインストールも不要で、画面上部の **Session ブロック**に、現在のセッションのトークン使用統計が表示されます。

公式ドキュメントに載っている表示例がこちらです。

```text
Total cost:            $0.55
Total duration (API):  6m 19.7s
Total duration (wall): 6h 33m 10.2s
Total code changes:    0 lines added, 0 lines removed
```

それぞれの意味はこうです。

| 表示 | 内容 |
|---|---|
| `Total cost` | このセッションのコスト**推定値**（後述：請求額とは別物） |
| `Total duration (API)` | API が実際に処理していた時間 |
| `Total duration (wall)` | セッションを開いていた実時間（壁時計時間） |
| `Total code changes` | 追加・削除した行数 |

### ⚠️ 注意：`Total cost` は「請求額」ではない

ここは誤解しやすいので公式の言葉どおりに書きます。

- `Total cost` の金額は、**トークン数からローカルで計算された推定値**で、**実際の請求額と異なる場合があります**（公式ドキュメント原文："The dollar figure is an estimate computed locally from token counts and may differ from your actual bill."）。
- そもそも **Session ブロックは API ユーザー向け**の表示です。**Claude Max / Pro のサブスク利用者は、使用量がサブスクに含まれている**ため、このセッションコストの数字は請求の観点では関係しません。
- 正式な請求を確認したいなら、**Claude Console の Usage ページ**を見る、というのが公式の案内です。

つまりサブスク勢にとって `Total cost` は「請求書」ではなく、**セッションの重さを測る目安メーター**として使うのが正しい読み方です。

---

## Pro / Max / Team / Enterprise だと「内訳」が見える（ここが本題）

ここからがトークンダイエットの肝です。

**Pro・Max・Team・Enterprise プランの場合**、`/usage` は同じ画面に追加で

- **Plan usage bars**（プラン上限に対する使用量バー）
- **Activity stats**（活動統計）
- そして **使用量の内訳（breakdown）**

を表示します。

この内訳が重要で、公式ドキュメントによると **直近の使用量を「スキル / サブエージェント / プラグイン / 個別の MCP サーバー」ごとに割り当て、それぞれを全体に対する％で表示**します。

> 原文："It attributes recent usage to skills, subagents, plugins, and individual MCP servers, with each shown as a percentage of the total."

つまり「**何が自分のトークンを食っているのか**」を、感覚ではなく％で名指しできるわけです。

### 期間の切り替え：`d` と `w`

内訳表示の画面では、

- **`d` キー → 直近24時間**
- **`w` キー → 直近7日間**

を切り替えられます（原文："Press `d` or `w` to switch between the last 24 hours and the last 7 days."）。

「今日の作業」で重いものと、「この一週間ずっと重い」ものは別問題です。常に重い MCP サーバーは7日表示で浮かび上がります。

### ⚠️ この内訳には「但し書き」がある

数字を鵜呑みにしないために、公式の制限事項もそのまま書きます。

- 表示される数字は **approximate（概算）**。
- **このマシンのローカルなセッション履歴から計算**されている。
- したがって **他のデバイスや claude.ai 上での使用は含まれない**。

複数マシンで Claude Code を使っている人は、「1台分の概算を見ている」と理解した上で読むのが正解です。

---

## `/usage` のエイリアスと、混同しやすい `/context`

`/usage` には公式のエイリアス（別名）があります。

| コマンド | 公式の説明 |
|---|---|
| `/usage` | セッションコスト・プラン使用上限・活動統計を表示。Pro/Max/Team/Enterprise ではスキル・サブエージェント・プラグイン・MCPサーバー別の内訳も表示 |
| `/cost` | **`/usage` のエイリアス** |
| `/stats` | **`/usage` のエイリアス**（Stats タブで開く） |

打ちやすいものを使えば同じ画面に行けます。

そして、よく混同されるのが `/context` です。これは**別物**なので役割を分けて覚えてください。

| コマンド | 何を見るもの |
|---|---|
| `/usage` | **コスト・プラン使用量・利用内訳**（時間軸：直近24h/7日） |
| `/context` | **今このセッションのコンテキストウィンドウの中身**を色付きグリッドで可視化。最適化の提案も出す（原文："Visualize current context usage as a colored grid. Shows optimization suggestions..."） |

ざっくり言うと、`/usage` は「期間で見るお金・使用量メーター」、`/context` は「今この瞬間のコンテキストの地図」です。**「何が context を占めているか」を直接見たいときは `/context`** が正解で、こちらは tool 単位・メモリ肥大・容量警告まで出してくれます。

---

## 見えたら、どこを削るか（公式の削減策に直結させる）

`/usage` の内訳や `/context` で「重い犯人」が分かったら、公式ドキュメントが挙げている削減策にそのまま接続します。ここも**公式に書かれている手段だけ**を並べます。

### 1. MCP サーバーが重いと出たら

- MCP のツール定義は**デフォルトで遅延ロード（deferred）**で、Claude が実際にそのツールを使うまではツール名しか context に入りません。何が context を消費しているかは **`/context` で確認**できます。
- それでも常時重い MCP があるなら、**`/mcp` で設定済みサーバーを確認し、使っていないものを無効化**します。
- そもそも **`gh` / `aws` / `gcloud` / `sentry-cli` のような CLI が使えるなら、そちらの方が context 効率が良い**（per-tool のリスト分が乗らない）と公式は推奨しています。

### 2. スキル / CLAUDE.md が重いと出たら

- **CLAUDE.md はセッション開始時に context へ読み込まれます**。PRレビューやDBマイグレーションのような「特定ワークフロー専用の詳細手順」が書いてあると、無関係な作業中もそのトークンが居座ります。
- 対策は、**専用手順をスキルへ移すこと**。スキルは**呼ばれたときだけオンデマンドで読み込まれる**ので、ベースの context が小さくなります。
- 公式の目安は **「CLAUDE.md は200行未満を目指す（本質だけ残す）」**です。

> ここで配布している無料リポの「CLAUDE.md設計」スキルは、まさにこの「太った CLAUDE.md をどう分割・整理するか」の型をまとめたものです（記事末の「今すぐ試す」へ）。

### 3. サブエージェント / エージェントチームが重いと出たら

- ログ処理・テスト実行・ドキュメント取得のような**冗長な出力はサブエージェントに委譲**すると、その大量出力はサブエージェント側の context に留まり、メインには要約だけが返ります。
- ただし**エージェントチームはトークンを食う**点に注意。公式は「**teammates が plan mode で動くと標準セッションの約7倍のトークンを使う**（each teammate が自分の context window を持つため）」と明記しています。チームのタスクは小さく自己完結させるのが推奨です。

### 4. それ以外の定番削減策（公式記載）

- **`/clear`**：無関係な作業に切り替えるときに context をリセット。古い context は以降の全メッセージでトークンを無駄に消費します。
- **`/compact [指示]`**：会話が長くなったら要約で context を圧縮。`/compact Focus on code samples and API usage` のように残したい観点を指定できます。
- **`/model`**：多くのコーディング作業は Sonnet で十分で Opus より安価、と公式は案内しています。込み入った設計や多段推論のときだけ Opus を使う、という使い分けです。
- **`/effort`**：拡張思考（extended thinking）の effort level を下げるとコストを下げられます（thinking トークンは出力トークンとして課金される）。簡単なタスクでは下げる。

---

## バックグラウンドでもトークンは少し使われる（豆知識）

「何もしていないのにトークンが動いている気がする」件についても、公式に説明があります。

Claude Code はアイドル時でも一部のバックグラウンド機能でトークンを使います。

- **会話の要約**（`claude --resume` 用に過去会話を要約するジョブ）
- **コマンド処理**（`/usage` のように状態確認のためリクエストを出すコマンドがある）

ただしこれらは**通常 1セッションあたり $0.04 未満**の少量、というのが公式の記載です（ユースケースによる、と理解しておくのが安全です）。

---

## まとめ：今日からの3手

1. まず **`/usage`（または `/cost` / `/stats`）** を打って、セッションの重さと、（Pro/Max/Team/Enterprise なら）スキル・サブエージェント・プラグイン・MCP別の％内訳を見る。`d`/`w` で24h↔7日を切り替える。
2. 「今この context の中身」を直接見たいときは **`/context`**。重い tool・メモリ肥大・容量警告まで出る。
3. 犯人が分かったら、**MCP無効化 / CLAUDE.md→スキル移行 / サブエージェント委譲 / `/clear`・`/compact`・`/model`・`/effort`** の公式策に接続する。

「なんとなく重い」を「％で名指しできる」に変えるだけで、削減の打ち手は一気に具体的になります。

---

## この記事の「context を軽くする」を、無料スキルで今すぐ試す

`/usage` で「CLAUDE.md やスキルが重い」と分かったとき、次にやることは **CLAUDE.md の整理（200行未満を目指す・専用手順はスキルへ）**です。その「型」を、そのままコピーして使える形（手順・アンチパターンつき）で無料公開しています（日本語・英語・CC BY 4.0、改変も商用も自由）。

**3ステップで試せます:**

**① リポを開く**
👉 https://github.com/noguso245-jpg/claude-code-skills-starter

**② コンテキスト整理に効く2本をコピーする**（コピペ1回）
```bash
git clone https://github.com/noguso245-jpg/claude-code-skills-starter
cp claude-code-skills-starter/skills/ja/claude-md-architecture.md  your-project/.claude/skills/
cp claude-code-skills-starter/skills/ja/agile-prompt-template.md   your-project/.claude/skills/
```

**③ 役に立ったら ⭐ Star を押す**
⭐ は「同じくトークン消費に悩んでいる人に、このリポが見つかりやすくなる」応援です。
新しい無料スキルの追加を追いたい方は **👁 Watch** にすると更新が通知されます。

「次はこのテーマを掘ってほしい」という要望もコメントで歓迎です。

---

**X（最新情報）:** [@k___n___t_1125](https://x.com/k___n___t_1125)
新しい無料スキルを追加したら、最初にXで告知します。トークン削減ネタを追いたい方はフォローしておくと取りこぼしません。

---

### 参考（公式ドキュメント）

- Manage costs effectively（`/usage` の表示・内訳・`d`/`w`切替・ローカル概算の但し書き・削減策・バックグラウンド消費）: https://code.claude.com/docs/en/costs
- Commands リファレンス（`/usage`・`/cost`・`/stats` のエイリアス関係、`/context`・`/compact`・`/clear`・`/model`・`/effort`・`/mcp` の説明）: https://code.claude.com/docs/en/commands
