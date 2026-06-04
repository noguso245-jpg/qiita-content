---
title: Claude Code の Hooks 実用設定 — 「毎回お願いしていること」をフックで自動化する
tags:
  - ClaudeCode
  - AI
  - 生成AI
  - 個人開発
  - プロンプトエンジニアリング
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

Claude Codeをしばらく使っていると、こんな「毎回の手作業」が溜まってきませんか。

- ファイルを編集させたあと、自分で毎回フォーマッタやLintをかけている
- 「危ないコマンドだけは絶対に止めたい」が、毎回確認に頼っている
- どのコマンドを実行したか、あとから追えるようにログを残したい
- 作業が一区切りついたタイミングで、決まった処理を走らせたい

これらは**Hooks（フック）**で自動化できます。Hooksは「Claude Codeが特定のイベントを起こしたときに、自分で決めたコマンドを自動で実行する」仕組みです。この記事では、Hooksの基本構造と、すぐ使える実用設定をまとめます。

> 注意: Hooksの仕様（イベント名・出力フィールドなど）は変わることがあります。本記事は執筆時点（2026年6月）の公式ドキュメントを参照していますが、実際に設定する際は手元の最新ドキュメントで確認してください。

---

## Hooksとは — 「イベントが起きたら、このコマンドを走らせる」

Hooksは `settings.json` に書く設定です。「いつ（イベント）」「どのツールに対して（matcher）」「何を実行するか（command）」の3つを指定します。

代表的なイベントは次のとおりです（執筆時点）。

| イベント | 発火タイミング |
|---|---|
| `PreToolUse` | ツールを実行する**直前** |
| `PostToolUse` | ツールを実行した**直後** |
| `UserPromptSubmit` | ユーザーがプロンプトを送信したとき |
| `Stop` | Claudeが応答を終えようとするとき |
| `SubagentStop` | サブエージェントが終了しようとするとき |

ポイントは、`PreToolUse` は実行を**止められる**ことです。「このコマンドは危ないから実行させない」という制御に使えます。一方 `PostToolUse` は「やった後に走らせる」ので、フォーマットやログ向きです。

---

## 設定の置き場所と基本の形

Hooksはプロジェクト単位なら `.claude/settings.json` に書きます。最小構成は次の形です。

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/lint-check.sh"
          }
        ]
      }
    ]
  }
}
```

読み方はこうです。

- `PostToolUse`: ツール実行の直後に
- `"matcher": "Edit|Write"`: Edit または Write（=ファイル編集系）のツールが使われたら
- `"command"`: 指定したスクリプトを実行する

`matcher` はツール名にマッチさせるフィルタです。`Bash` だけ、`Edit|Write` のように複数、という指定ができます。

---

## 実用例1: 編集のたびに自動フォーマット・Lint

一番効果が分かりやすいのがこれです。Claudeがファイルを書き換えるたびに、自分のプロジェクトのフォーマッタを走らせます。

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/lint-check.sh"
          }
        ]
      }
    ]
  }
}
```

`lint-check.sh` の中身は、自分のプロジェクトに合わせて `npm run lint` や `prettier --write` などを呼ぶだけです。これで「編集してもらったあと、自分で整形をかけ直す」という地味な手間がなくなります。

---

## 実用例2: 危険なコマンドを実行前にブロックする

`PreToolUse` は実行を止められるので、安全ガードに向きます。Hookのスクリプト側で、入力（実行されようとしているコマンド）を見て判断します。

公式ドキュメントの例では、スクリプトの**終了コード**で制御します。

```bash
#!/bin/bash
# 標準入力にイベント情報がJSONで渡される
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

if echo "$COMMAND" | grep -q "drop table"; then
  echo "Blocked: dropping tables is not allowed" >&2  # stderr がClaudeへのフィードバックになる
  exit 2                                               # exit 2 = この操作をブロック
fi

exit 0  # exit 0 = 判断なし。通常の権限フローに任せる
```

重要なルールは次の2点です（執筆時点の仕様）。

- `exit 2`: その操作を**ブロック**する。`PreToolUse` ならツール実行を止める
- `exit 0`: 判断しない。通常の権限確認フローに任せる

標準エラー出力（`>&2`）に書いた内容が、Claudeへのフィードバックとして渡ります。「なぜ止めたか」を書いておくと、Claudeが別の方法を考えやすくなります。

---

## 実用例3: 実行したBashコマンドをログに残す

「何を実行したか」を後から追いたいときは、`PostToolUse` で記録します。

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.command' >> ~/.claude/command-log.txt"
          }
        ]
      }
    ]
  }
}
```

Bashツールが使われるたびに、実行コマンドを `command-log.txt` に追記します。何かおかしくなったときに「どこで何をしたか」を振り返れるので、長い作業の安心材料になります。

---

## 使い分けの考え方

| やりたいこと | 使うイベント | 制御方法 |
|---|---|---|
| 編集後にフォーマット・Lint | `PostToolUse` (matcher: Edit\|Write) | コマンドを走らせるだけ |
| 危険コマンドを止める | `PreToolUse` (matcher: Bash) | スクリプトで `exit 2` |
| 実行ログを残す | `PostToolUse` (matcher: Bash) | コマンドを走らせるだけ |

考え方はシンプルです。**「止めたい」なら `PreToolUse` + `exit 2`、「やった後に処理したい」なら `PostToolUse`** です。

---

## 導入のコツ

最初から全部入れようとせず、**一番ストレスになっている1つ**から始めるのがおすすめです。多くの人にとっては「編集後の自動フォーマット」が効果を実感しやすい入口です。

また、Hookのスクリプトは普通のシェルスクリプトなので、まず手元で単体実行して期待どおり動くか確認してから登録すると安全です。`PreToolUse` でブロック系を入れる場合は、誤って必要な操作まで止めないか、テスト用のコマンドで挙動を見てから本番に入れると安心です。

---

## まとめ

- Hooksは「イベントが起きたら、自分で決めたコマンドを自動実行する」仕組み
- `PostToolUse` は「やった後の処理」（フォーマット・ログ）向き
- `PreToolUse` は「やる前のチェック」向き。`exit 2` で操作を止められる
- 設定は `.claude/settings.json` に書き、`matcher` でツールを絞る

まずは編集後の自動フォーマットから始めて、慣れてきたら危険コマンドのガードやログ記録を足していくと、無理なく「毎回の手作業」を減らせます。

---

## 補足: フック設計の土台になる無料リポジトリ

Hooksは「毎回やっている手作業」を見つけて自動化する仕組みです。その前段として、`CLAUDE.md` や開発の進め方の型が整っていると、何を自動化すべきかが見えやすくなります。私が使っているスキルを無料で公開しています。

**無料スターター（GitHub・CC BY 4.0）:**
https://github.com/noguso245-jpg/claude-code-skills-starter

CLAUDE.md設計・計画ファースト開発（PIV）・AIコミット戦略・アジャイルなプロンプト設計の4本のスキルが日本語・英語で入っています。開発の型を整えてから、繰り返しの作業をHooksに逃がしていくとスムーズです。まずは無料リポジトリから試してみてください。

---

最新のTipsはXでも発信しています: [@k___n___t_1125](https://x.com/k___n___t_1125)
