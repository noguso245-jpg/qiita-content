---
title: 'Claude Code をシェルに組み込む：claude -p（ヘッドレス実行）で対話せず1コマンド自動化する実践'
tags:
  - ClaudeCode
  - 生成AI
  - CLI
  - 自動化
  - シェルスクリプト
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

## あるある課題：「便利なのに、毎回手で対話している」

Claude Code を毎日使っていると、こんな状態になりがちです。

- コミット前に「この diff にタイポない？」と毎回対話で聞いている
- ビルドが落ちるたびにログを手でコピペして「原因を説明して」と貼っている
- リリースノートの下書きを、毎回エディタを開いて手作業で作っている

どれも「Claude に投げて、答えを受け取る」だけの単純作業です。なのに毎回ターミナルの対話 UI を開き、貼り付け、結果をコピーして別の場所に貼る。**対話だから自動化に組み込めない** ── これがこの記事のテーマです。

Claude Code には対話 UI を起動せず、**1コマンドで結果だけを得る** ヘッドレス実行（print mode）があります。`-p` を付けるだけで、`grep` や `jq` と同じく「stdin を読み、stdout に吐く普通のコマンド」になります。本記事は、これをシェルスクリプト・パイプライン・cron に組み込むための実践に絞ります。

> 注: 本記事のフラグ・出力仕様は公式ドキュメント（[headless](https://code.claude.com/docs/en/headless) / [CLI reference](https://code.claude.com/docs/en/cli-reference)）で確認できる内容に限定しています。

---

## 1. 基本：`-p` で非対話実行

`claude` コマンドに `-p`（`--print`）を付けると、対話セッションを起動せず、応答を出力して終了します。

```bash
claude -p "What does the auth module do?"
```

これだけです。プロンプトを引数で渡し、結果が標準出力に返ってきます。すべての CLI オプションは `-p` と併用できます。

| | 対話モード（`claude`） | ヘッドレス（`claude -p`） |
|---|---|---|
| 起動 | TUI を開いて待機 | 即実行して終了 |
| 入力 | キーボードで逐次 | 引数 or stdin |
| 出力 | 画面に描画 | stdout（リダイレクト可） |
| 自動化 | 組み込みにくい | パイプ・スクリプトに組める |

### スクリプト用には `--bare` を検討する

CI やスクリプトで「どのマシンでも同じ結果」が欲しい場合、`--bare` を付けると hooks・skills・plugins・MCP サーバー・auto memory・CLAUDE.md の自動読み込みをスキップして起動が速くなります。

```bash
claude --bare -p "Summarize this file" --allowedTools "Read"
```

`--bare` モードでは Bash・ファイル読み取り・ファイル編集ツールにアクセスできます。チームメイトの `~/.claude` にあるフックやプロジェクトの `.mcp.json` を拾わないため、**環境差で挙動が変わるのを防げます**。必要なコンテキストは明示的にフラグで渡します（システムプロンプト追記なら `--append-system-prompt`、MCP なら `--mcp-config` 等）。

> 公式ドキュメントでは `--bare` を「スクリプト・SDK 呼び出しに推奨」とし、将来 `-p` の既定になる予定と記載されています。

---

## 2. パイプで前後に繋ぐ

ヘッドレスモードは stdin を読みます。つまり Unix の普通のコマンドと同じく、**パイプで流し込み、リダイレクトで受け取れます**。

ビルドエラーログを流し込んで、原因の説明をファイルに書き出す例：

```bash
cat build-error.txt | claude -p 'concisely explain the root cause of this build error' > output.txt
```

git の差分をそのまま渡して、タイポを指摘させる例：

```bash
git diff main | claude -p "you are a typo linter. report filename:line and the issue. return nothing else."
```

差分を**パイプで渡す**点がポイントです。Claude に Bash 権限を与えて自分で `git diff` を実行させる必要がなくなり、権限面でも安全になります。

> 注意: stdin は 10MB が上限です（Claude Code v2.1.128 時点）。超えると非ゼロ終了コードでエラー終了します。大きい入力はファイルに書き、プロンプト内でそのパスを参照してください。

### `package.json` のスクリプトに組み込む

プロジェクト固有の簡易リンターとして wrap できます。

```json
{
  "scripts": {
    "lint:claude": "git diff main | claude -p \"you are a typo linter. for each typo in this diff, report filename:line on one line and the issue on the next. return nothing else.\""
  }
}
```

`npm run lint:claude` で実行。エスケープした二重引用符で Windows でも動くようにしています。

---

## 3. 構造化出力：`--output-format` で機械可読にする

後続処理に渡すなら、テキストではなく JSON で受け取るのが定石です。`--output-format` で出力形式を選べます。

| 値 | 内容 |
|---|---|
| `text`（既定） | プレーンテキスト |
| `json` | result・session ID・メタデータを含む構造化 JSON |
| `stream-json` | 改行区切り JSON（リアルタイムストリーミング用） |

```bash
claude -p "Summarize this project" --output-format json
```

JSON で受け取ると、`result` フィールドにテキスト結果、加えて `session_id` などのメタデータが入ります。`--output-format json` のときは **`total_cost_usd`（実行ごとのコスト）** も payload に含まれるため、スクリプト側で1回ごとの支出を追えます。

### jq で必要なフィールドだけ抜く

```bash
# テキスト結果だけ取り出す
claude -p "Summarize this project" --output-format json | jq -r '.result'
```

### スキーマに沿った出力：`--json-schema`

「関数名の配列が欲しい」のように、**形を固定したい**ときは `--output-format json` と `--json-schema` を併用します。結果は `structured_output` フィールドに入ります（print mode 専用）。

```bash
claude -p "Extract the main function names from auth.py" \
  --output-format json \
  --json-schema '{"type":"object","properties":{"functions":{"type":"array","items":{"type":"string"}}},"required":["functions"]}' \
  | jq '.structured_output'
```

### ストリーミングで逐次表示

`--output-format stream-json` を `--verbose` および `--include-partial-messages` と組み合わせると、トークンを生成され次第受け取れます。各行が JSON イベントです。

```bash
claude -p "Write a poem" --output-format stream-json --verbose --include-partial-messages | \
  jq -rj 'select(.type == "stream_event" and .event.delta.type? == "text_delta") | .event.delta.text'
```

`jq -r`（生文字列）と `-j`（改行なし連結）で、トークンが連続的に流れます。

---

## 4. ツール権限：`--allowedTools` で「止まらない」自動化にする

ヘッドレス実行の最大の落とし穴は **権限プロンプトで止まること**。スクリプトの途中で「このツールを許可しますか？」と待たれては自動化になりません。`--allowedTools` でプロンプトなしに使えるツールを明示します。

```bash
claude -p "Run the test suite and fix any failures" \
  --allowedTools "Bash,Read,Edit"
```

`--allowedTools` は[権限ルール構文](https://code.claude.com/docs/en/settings#permission-rule-syntax)に対応しており、コマンド単位で絞れます。コミットを作る例：

```bash
claude -p "Look at my staged changes and create an appropriate commit" \
  --allowedTools "Bash(git diff *)" "Bash(git log *)" "Bash(git status *)" "Bash(git commit *)"
```

末尾の ` *`（前にスペース）で前方一致になります。`Bash(git diff *)` は `git diff` で始まる任意のコマンドを許可。**スペースが無い** `Bash(git diff*)` だと `git diff-index` まで一致してしまうので注意。

### セッション全体の基準を決める：`--permission-mode`

個別ツールを列挙する代わりに、[permission mode](https://code.claude.com/docs/en/permission-modes) で全体方針を設定できます。

```bash
# 編集を自動承認（mkdir/touch/mv/cp 等の一般的なファイル操作も自動承認）
claude -p "Apply the lint fixes" --permission-mode acceptEdits
```

ロックダウンした CI 向けには `dontAsk` があります。これは `permissions.allow` ルールか読み取り専用コマンド集合に無いものを拒否します。それ以外のシェルコマンドやネットワークアクセスは `--allowedTools` か `permissions.allow` のルールが必要で、無いと実行時に run が中断します。

> Before/After で見ると効果が明確です。
>
> **Before（対話のまま）**: cron で `claude -p "..."` を叩く → ツール許可プロンプトで永久に待機 → ジョブがハング。
>
> **After（明示）**: `--allowedTools` か `--permission-mode` を付与 → 止まらず完走 → ジョブが正常終了。

---

## 5. システムプロンプトを上書き／追記する

役割を与えたいときは `--append-system-prompt` でデフォルト挙動を保ったまま指示を追記します。PR diff をセキュリティレビューさせる例：

```bash
gh pr diff "$1" | claude -p \
  --append-system-prompt "You are a security engineer. Review for vulnerabilities." \
  --output-format json
```

公式が提供するシステムプロンプト系フラグは4つ（対話・非対話どちらでも動作）：

| フラグ | 挙動 |
|---|---|
| `--system-prompt` | デフォルトを全置換 |
| `--system-prompt-file` | ファイル内容で全置換 |
| `--append-system-prompt` | デフォルトに追記 |
| `--append-system-prompt-file` | ファイル内容を追記 |

`--system-prompt` と `--system-prompt-file` は同時指定不可。**Claude Code をコーディング助手として残したまま追加ルールを足す**なら append 系、**コーディング以外の用途**でアイデンティティごと差し替えるなら replace 系を選びます（replace するとツールガイダンスや安全指示も消えるため、自分で責任を持つ範囲が広がります）。

---

## 6. 会話の継続：`--continue` / `--resume`

ヘッドレスでも会話を繋げます。直近の会話を続けるなら `--continue`、特定セッションを指すなら `--resume <session-id>`。

```bash
# 1回目
claude -p "Review this codebase for performance issues"

# 直近の会話を継続
claude -p "Now focus on the database queries" --continue
```

複数の会話を回すなら session ID を捕まえて指定します。

```bash
session_id=$(claude -p "Start a review" --output-format json | jq -r '.session_id')
claude -p "Continue that review" --resume "$session_id"
```

---

## 7. cron / シェルスクリプトの実例

ここまでの部品を組むだけです。毎朝、前日の git ログから日報の下書きを生成する例：

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/work/myrepo"

git log --since="yesterday" --pretty=format:'%h %s' \
  | claude --bare -p "これは昨日のコミット一覧です。日本語で簡潔な進捗サマリを箇条書きで作って。" \
      --output-format json \
  | jq -r '.result' > "$HOME/reports/$(date +%F).md"
```

cron に登録（毎朝9時）：

```cron
0 9 * * * /home/me/bin/daily-summary.sh >> /home/me/logs/claude-cron.log 2>&1
```

ポイントは下記の通りです。

- **`--bare`** で環境差を排除し、起動を速く・安定させる
- **`--output-format json` + `jq -r '.result'`** でテキストだけ確実に取り出す
- **`set -euo pipefail`** で失敗を握りつぶさない
- ログを `2>&1` で残し、後から検証できるようにする

---

## 8. 注意点：権限・コスト・冪等性

自動化に乗せる前に、必ず押さえておくべき3点です。

### 権限

cron や CI は**無人**です。`--allowedTools` か `--permission-mode` を必ず明示し、プロンプト待ちでハングしないようにします。逆に「何でも許可」は危険なので、`Bash(git *)` のように**必要なコマンドだけ**を許可するのが基本。`--bare` を併用すると、ローカルの設定に影響されず許可範囲を flag だけで完結させられます。

### コスト

ヘッドレス実行も API/利用枠を消費します。対策として公式が提供する仕組みを使います。

- `--output-format json` の `total_cost_usd` で**1回ごとの実費を記録**する
- `--max-budget-usd` で**上限額**を設定（print mode 専用。超えると停止）
- `--max-turns` で**エージェントのターン数**を制限（print mode 専用。上限到達でエラー終了）

```bash
claude -p --max-budget-usd 0.50 --max-turns 5 "..." 
```

> 補足: 公式ドキュメントには「2026年6月15日以降、サブスクリプションプランでの Agent SDK / `claude -p` 利用は、対話利用とは別枠の月次 Agent SDK クレジットから消費される」旨の注記があります。料金体系の最新情報は必ず公式ドキュメントで確認してください。

### 冪等性

自動化で一番事故りやすいのがここです。同じジョブが複数回走っても安全か（重複コミット・重複ファイル作成をしないか）を設計で担保します。

- 生成結果を**いったんファイルに書き出す**だけにして、適用（commit/push）は別ステップに分ける
- セッションを残したくないバッチには `--no-session-persistence`（print mode 専用、ディスクに保存しない）
- LLM 出力は実行ごとに揺れる前提で、**人手ゲート**（レビューしてから反映）を1段挟む

---

## まとめ

| やりたいこと | 使うフラグ |
|---|---|
| 対話せず1発で実行 | `-p` / `--print` |
| 起動を速く・環境差を排除 | `--bare` |
| 機械可読な出力 | `--output-format json`（+ `jq`） |
| 形を固定した出力 | `--json-schema` |
| 逐次ストリーミング | `--output-format stream-json --verbose --include-partial-messages` |
| プロンプト待ちで止めない | `--allowedTools` / `--permission-mode` |
| 役割を足す | `--append-system-prompt` |
| 会話を繋ぐ | `--continue` / `--resume` |
| コスト・暴走を抑える | `--max-budget-usd` / `--max-turns` |

「対話では使えるが自動化に組み込めていない」段階から抜け出す鍵は、`claude -p` を **`grep` や `jq` と同じ普通のコマンドとして扱う** ことです。stdin で流し、JSON で受け、`jq` で抜き、権限を明示し、コスト上限を付ける。これだけで、毎日の手作業の多くがスクリプト1本に畳めます。

---

## 無料リポで関連スキルも配布中（CC BY 4.0）

本記事で紹介した手順はそのままコピペして使えます。あわせて無料リポ **claude-code-skills-starter** では、実用スキル4本（claude-md-architecture / piv-development-loop / ai-commit-strategy / agile-prompt-template）＋ CLAUDE.md テンプレート＋ pre-commit hook を配布しています。

1. リポを開く → https://github.com/noguso245-jpg/claude-code-skills-starter
2. `skills/ja/` の該当スキル .md をコピーして自分のプロジェクトで使う
3. 役立ったら ⭐ Star を（同じように探している人に見つけてもらいやすくなります。更新を追うなら Watch）
