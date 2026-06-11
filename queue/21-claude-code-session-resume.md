---
title: 'Claude Code のセッションが途中で切れて困らない技術：--continue / --resume で長時間タスクを引き継ぐ実践'
tags:
  - ClaudeCode
  - 生成AI
  - 開発効率化
  - CLI
  - AIエージェント
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

## あるある：「あの会話、もう一回はじめからやり直し…？」

Claude Code で大きめのリファクタを走らせている最中に、ターミナルを閉じてしまった。PC を再起動した。別の作業に切り替えて、戻ってきたら端末が消えていた。

そこでこう思った経験はないでしょうか。

> 「さっきまでの長い会話、もう一回はじめから説明し直すのか…」

結論から言うと、その必要はありません。Claude Code はセッション（会話）をローカルに保存しているので、**`--continue` / `--resume` で直前の会話に戻れます**。さらに「会話を分岐させる」「適切なタイミングで新セッションに切る」「引き継ぎメモを残す」といったコツを押さえると、長時間タスクが途切れても作業が崩壊しません。

この記事は、毎日 Claude Code を使うエンジニア向けに、**セッション継続・再開だけ**に絞って実践をまとめます。Git worktree やコンテキスト設計、コミット戦略といったテーマは扱いません。

> 本記事のフラグ・コマンドの挙動は、公式ドキュメント（[CLI reference](https://code.claude.com/docs/en/cli-reference) / [Commands](https://code.claude.com/docs/en/commands) / [Explore the context window](https://code.claude.com/docs/en/context-window)）で確認できる事実に基づいています。バージョンによって挙動が変わる場合があるため、迷ったら `claude --help` と公式ドキュメントを確認してください。

---

## まず全体像：3つの戻り方

| やりたいこと | コマンド | ひとことで |
| :--- | :--- | :--- |
| 直前の会話に戻る | `claude --continue`（`-c`） | カレントディレクトリの**最新会話**をそのまま開く |
| 特定の会話を選んで戻る | `claude --resume`（`-r`） | ID・名前指定、または**ピッカーで選択** |
| いまの会話の中で過去に戻す | `/rewind` | 会話とコードを**チェックポイントまで巻き戻す** |

「直近の続きでいい」なら `--continue`、「どの会話か選びたい」なら `--resume`、というのが基本の使い分けです。

---

## 1. `--continue`：直前の会話をそのまま再開する

一番シンプルな再開方法です。**作業していたディレクトリで**次を実行します。

```bash
claude --continue
# 短縮形
claude -c
```

公式の説明はこうです。

> Load the most recent conversation in the current directory.（カレントディレクトリの最新の会話を読み込む）

ポイントは2つ。

- **ディレクトリ単位**で「最新の会話」を探す。だから `--continue` は、その会話を始めたのと同じディレクトリで実行する必要があります。
- 別ディレクトリで `/add-dir` してそのディレクトリを追加していたセッションも対象に含まれます。

非対話（スクリプト）でも使えます。最新会話の続きとして一発クエリを投げたいとき：

```bash
claude -c -p "さっきの変更で型エラーが残っていないか確認して"
```

### よくあるハマり：別ディレクトリで叩いて「会話が見つからない」

`--continue` は **カレントディレクトリ基準**です。`~/projectA` で作業していた会話を `~/` で `claude -c` しても見つかりません。再開したい会話を始めたディレクトリに `cd` してから実行しましょう。

---

## 2. `--resume`：どの会話に戻るか選んで再開する

「最新じゃなくて、3つ前のあの会話に戻りたい」「並行でいくつか走らせていてどれか分からない」――そんなときは `--resume` です。

```bash
# ピッカー（一覧）を開いて選ぶ
claude --resume
claude -r

# ID または名前を直接指定
claude --resume auth-refactor
claude -r "auth-refactor" "このPRを仕上げて"
```

公式の説明：

> Resume a specific session by ID or name, or show an interactive picker to choose a session.（ID か名前で特定セッションを再開、または対話的ピッカーで選択）

引数なしで叩くと一覧が出るので、過去の会話をプレビューしながら選べます。**名前を付けておくとここで一目で分かる**ので、後述の命名がここで効いてきます。

セッション内からでも `/resume`（エイリアス `/continue`）で同じことができます。

```text
/resume
/resume auth-refactor
```

### セッションに名前を付けておく

`--resume` のピッカーは、名前を付けておくと探すのが圧倒的に楽になります。

```bash
# 起動時に名前を付ける
claude --name "auth-refactor"
claude -n "auth-refactor"
```

セッションの途中で `/rename` を使って名前を付ける／付け直すこともできます。

```text
/rename auth-refactor
```

> `/rename` に名前を渡さないと、会話履歴から自動で名前を生成します。

---

## 3. `--continue` / `--resume` で「元の会話を汚さず」分岐する

長時間タスクで地味に効くのが `--fork-session` です。

> When resuming, create a new session ID instead of reusing the original.（再開時に、元のセッションを再利用せず新しいセッションIDを作る）

つまり、**元の会話はそのまま残したまま**、そのコピーから別方向を試せます。

```bash
# resume と組み合わせて分岐
claude --resume auth-refactor --fork-session
```

「いまの状態から A 案と B 案を別々に試したい」ときに、元の会話を壊さずに済みます。

セッション内なら `/branch` で同じ発想の分岐ができます。

> Create a branch of the current conversation at this point, so you can try a different direction without losing the conversation as it stands.（この時点で会話を分岐させ、いまの会話を失わずに別方向を試せる）

元の会話には `/resume` で戻れます。

---

## 4. いつ「新セッション」にすべきか：`/clear` の使いどころ

再開とは逆に、**わざと会話を切る**判断も重要です。タスクが変わったのに前の会話を引きずると、関係ないファイル読み込みや古い文脈がコンテキストを圧迫し、毎メッセージのコストも増えます。

無関係な作業に切り替えるときは `/clear` です。

> Start a new conversation with empty context. The previous conversation stays available in `/resume`.（空のコンテキストで新しい会話を開始。前の会話は `/resume` から引き続き利用可能）

重要なのは、**`/clear` しても前の会話は消えない**こと。`/resume` のピッカーに残るので、後で戻れます。さらに名前を渡すとピッカーで識別しやすくなります。

```text
/clear              # 新しい会話を開始（前の会話は /resume に残る）
/clear auth-done    # 前の会話に "auth-done" とラベルを付けて新規開始
```

`/clear` のエイリアスは `/reset`、`/new` です。

### Before / After：タスク切り替え時の振る舞い

```text
# Before（同じ会話で別タスクを続ける）
[認証リファクタの長い会話] → そのまま「次はCSSのバグ」を投げる
→ 認証の文脈が残ったまま。無関係なファイル履歴がコンテキストを圧迫

# After
[認証リファクタの長い会話] → /clear auth-refactor で一区切り
→ CSSバグ用のクリーンな会話で開始
→ 認証の続きが必要になったら /resume auth-refactor で復帰
```

---

## 5. `/clear` と `/compact` の使い分け

ここを混同しがちなので整理します。

| | `/clear` | `/compact` |
| :--- | :--- | :--- |
| 何をする | **新しい会話**を空コンテキストで開始 | **同じ会話を続けたまま**履歴を要約して圧縮 |
| 前の文脈 | 引き継がない（`/resume` には残る） | 要約として引き継ぐ |
| 使う場面 | **無関係なタスク**に切り替えるとき | **同じタスク**を続けたいがコンテキストを空けたいとき |

公式も `/clear` の説明でこう明言しています。

> To free up context while continuing the same conversation, use `/compact` instead.（同じ会話を続けながらコンテキストを空けたいなら、代わりに `/compact` を使う）

`/compact` は要約の焦点を指定できます。長い新タスクに入る前に、残したい論点を指定して圧縮しておくと精度が上がります。

```text
/compact focus on the auth bug fix
```

なお、コンテキストが上限に近づくと**自動で**コンパクションが走るので、フルになってもセッションが終わるわけではありません。`/compact` はそれを手動で、好きなタイミング・焦点で行うものだと考えると整理できます。

いまどのくらいコンテキストを使っているかは `/context` で確認できます。

---

## 6. 再開・コンパクション時に「何が戻り、何が戻らないか」

ここを理解していないと、「再開したらルールが効いてない？」と混乱します。公式の「[What survives compaction](https://code.claude.com/docs/en/context-window)」が一次情報です。

コンパクション後（≒長い会話を要約して圧縮した後）の各要素の扱い：

| 仕組み | コンパクション後 |
| :--- | :--- |
| システムプロンプト / output style | そのまま（メッセージ履歴の一部ではない） |
| プロジェクトルートの CLAUDE.md・スコープなしルール | ディスクから再注入される |
| 自動メモリ（auto memory） | ディスクから再注入される |
| `paths:` フロントマター付きのルール | 該当ファイルを再度読むまで失われる |
| サブディレクトリのネストした CLAUDE.md | そのディレクトリのファイルを再度読むまで失われる |
| 呼び出したスキル本体 | 再注入される（1スキル5,000トークン・合計25,000トークン上限、超過時は古いものから削除） |
| Hooks | 該当なし（コードとして実行されるので文脈ではない） |

実務上の要点：

- **プロジェクトルートの `CLAUDE.md` と通常ルールはディスクから再注入される**ので、再開後も基本ルールは効きます。
- 一方で **`paths:` 付きルールやネストした `CLAUDE.md` は、対応するファイルをもう一度読むまで戻りません**。再開直後に「あれ、このディレクトリ専用ルールが効いてない」と感じたら、まず対象ファイルを開かせるのが手です。
- どうしても圧縮をまたいで効かせたいルールは、`paths:` を外すか、プロジェクトルートの `CLAUDE.md` に移すのが公式の推奨です。
- スキル本体は再注入されますが**上限で切り詰められる**ため、`SKILL.md` は重要な指示をファイル先頭に置くと安全です（切り詰めは先頭を残す）。

> 注意：上の表は「コンパクション」時の扱いです。`--resume` で会話そのものを開き直す場合は、保存された会話トランスクリプトに戻ります。いずれにせよ「**ディスク上の CLAUDE.md / 自動メモリは再注入される／会話中に動的に読み込んだ文脈は要約で失われうる**」という性質を押さえておけば、再開後の挙動に驚かずに済みます。

---

## 7. 長期作業を「分割して引き継ぐ」コツ

セッション継続の機能を活かすには、**最初から引き継ぎ前提で作業を区切る**のがコツです。

### コツ1：会話に名前を付ける

`--name` / `/rename` で名前を付けておくだけで、`--resume` のピッカーが「日付と先頭文だけの羅列」から「目的が分かる一覧」に変わります。タスク単位で名前を決める習慣をつけましょう。

### コツ2：チェックポイントを意識する

`/rewind` は会話とコードを過去の地点まで巻き戻せます（エイリアス `/checkpoint`、`/undo`）。

> Rewind the conversation and/or code to a previous point.

「ここまでは確実に動く」という地点を意識しておくと、試行が失敗しても安全に戻れます。詳細は公式の [checkpointing](https://code.claude.com/docs/en/checkpointing) を参照してください。

### コツ3：引き継ぎメモを「ディスク」に残す

再開時に確実に戻ってくるのは **ディスク上のファイル**（CLAUDE.md / 自動メモリ）です。逆に、会話の途中で口頭で伝えただけの文脈は、コンパクションで要約されて細部が薄まることがあります。

だから、長期タスクの**現在地と次の一手は、会話ではなくファイルに書く**のが堅実です。たとえばリポジトリ内に進捗メモを置く運用にすると、`--resume` でも `/clear` 後でも、Claude にそのファイルを読ませるだけで文脈が復元できます。

```markdown
<!-- docs/WORKLOG.md（例）-->
## 現在のタスク: auth リファクタ
- [x] トークン更新ロジックを services/auth.ts に分離
- [ ] 既存テストの移行（tests/auth/ 配下）
- [ ] /login のリダイレクト挙動を確認
### 次の一手
tests/auth/refresh.test.ts から着手。モックは fixtures/token.json を流用。
```

再開後の最初の指示はこれだけで済みます。

```text
docs/WORKLOG.md を読んで、続きから進めて
```

### コツ4：区切りで `/compact` の焦点を指定する

長い会話を続けたまま次フェーズに入るなら、フェーズ境界で `/compact focus on ...` を入れて、残したい論点を自分で指定します。自動コンパクションに任せるより、要約に何を残すかをコントロールできます。

---

## 実践フロー：長時間タスクが途切れても崩れない型

最後に、一連の流れをまとめます。

```bash
# 1. 名前を付けて開始
claude -n "auth-refactor"

# （作業中）区切りで進捗を docs/WORKLOG.md に書かせる
#   → ディスクに残るので再開時に確実に戻る

# （会話が長くなってきたら）同じタスクを続けるなら焦点付きで圧縮
#   /compact focus on the auth refactor

# 2. うっかり閉じた／PCを再起動した → 同じディレクトリで再開
claude -c
#   または選んで再開
claude --resume auth-refactor

# 3. 別案を試したい → 元を汚さず分岐
claude --resume auth-refactor --fork-session

# 4. 全く別のタスクに移る → 一区切りして新規
#   /clear auth-refactor
#   （戻りたくなったら）claude --resume auth-refactor
```

この型を回せば、「途中で切れたから最初からやり直し」はほぼ無くなります。鍵は **会話に名前を付ける／進捗はディスクに書く／タスクが変わったら `/clear`／同じタスクは `--continue`・`--resume`** の4点です。

---

## まとめ

- **直前の続き**は `claude --continue`（`-c`）。カレントディレクトリ基準で最新会話を開く。
- **会話を選んで戻る**なら `claude --resume`（`-r`）。ID・名前指定かピッカー。`--name` / `/rename` で名前を付けると探しやすい。
- **元を汚さず分岐**したいなら `--fork-session`（または `/branch`）。
- **無関係なタスク**に切り替えるときは `/clear`（前の会話は `/resume` に残る）。**同じタスク**を続けてコンテキストを空けたいなら `/compact`。
- 再開・圧縮後は **ルートの CLAUDE.md / 自動メモリはディスクから再注入**される一方、**`paths:` 付きルールやネスト CLAUDE.md は対象ファイルを再度読むまで戻らない**。だから**引き継ぎメモはディスクに書く**のが堅実。

セッションは「使い捨て」ではなく「名前を付けて持ち越す資産」として扱う――これが長時間タスクを途切れさせないコツです。

---

## 無料リポで関連スキルも配布中（CC BY 4.0）

本記事で紹介した手順はそのままコピペして使えます。あわせて無料リポ **claude-code-skills-starter** では、実用スキル4本（claude-md-architecture / piv-development-loop / ai-commit-strategy / agile-prompt-template）＋ CLAUDE.md テンプレート＋ pre-commit hook を配布しています。

1. リポを開く → https://github.com/noguso245-jpg/claude-code-skills-starter
2. `skills/ja/` の該当スキル .md をコピーして自分のプロジェクトで使う
3. 役立ったら ⭐ Star を（同じように探している人に見つけてもらいやすくなります。更新を追うなら Watch）
