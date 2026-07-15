---
title: Claude Code のカスタムスキル(Skills)の作り方 — 「毎回の指示」を再利用できる部品にする
tags:
  - AI
  - 個人開発
  - 生成AI
  - プロンプトエンジニアリング
  - ClaudeCode
private: false
updated_at: '2026-06-17T17:35:12+09:00'
id: f437d4373b8b390800b4
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

Claude Codeを使っていると、「またこの指示を打つのか」という場面が増えてきませんか。

- 毎回ほぼ同じ手順を、その都度文章で説明している
- レビュー観点や手順を、思い出しながら毎回書いている
- 同じノウハウを別のプロジェクトでも使いたいのに、再利用できていない

こういう「繰り返す指示」は、**カスタムスキル（Skills）**として部品化できます。一度作っておけば、毎回ゼロから書かずに呼び出せます。この記事では、自作スキルの作り方を最小構成からまとめます。

> 注意: スキルの仕様（`SKILL.md` のフロントマター項目・置き場所など）は変わることがあります。本記事は執筆時点（2026年6月）の公式ドキュメントを参照していますが、作成時は手元の最新ドキュメントで確認してください。

---

## スキルとは — 「いつ使うか」と「何をするか」をまとめた部品

スキルは、`SKILL.md` という1つのファイルに「**いつ使うか（description）**」と「**何をするか（指示本文）**」を書いたものです。Claudeはこの description を見て、「今この作業はそのスキルを使う場面だ」と判断して読み込みます。

ディレクトリ構造はシンプルで、スキル名のフォルダの中に `SKILL.md` を置くだけです。公式ドキュメントの例です。

```bash
.claude/skills/processing-pdfs/
└── SKILL.md
```

フォルダ名（`processing-pdfs`）がスキルの名前になります。

---

## 最小構成: `SKILL.md` の中身

`SKILL.md` は2つのパートでできています。

1. **YAMLフロントマター**（`---` で囲む）: いつ使うかを示す `description`
2. **本文**（Markdown）: 実際にClaudeが従う指示

公式ドキュメントの例（変更の要約スキル）です。

```yaml
---
description: Summarizes uncommitted changes and flags anything risky. Use when the user asks what changed, wants a commit message, or asks to review their diff.
---

## Current changes

!`git diff HEAD`

## Instructions

Summarize the changes above in two or three bullet points, then list any risks you notice such as missing error handling, hardcoded values, or tests that need updating. If the diff is empty, say there are no uncommitted changes.
```

ここで重要なのが2点あります。

- `description`: 「何をするか」だけでなく「**いつ使うか（Use when ...）**」まで書く。これがスキル自動選択の精度を左右します
- `!`git diff HEAD``: バッククォートにビックリマークを付けた記法で、**コマンドの実行結果をスキルに取り込める**。上の例では差分を取り込んでから要約させています

---

## フロントマターで指定できる項目

公式ドキュメントには、`description` 以外にもいくつかの項目があります（執筆時点）。

```yaml
---
name: my-skill
description: What this skill does
disable-model-invocation: true
allowed-tools: Read Grep
---
Your skill instructions here...
```

| 項目 | 役割 |
|---|---|
| `name` | スキル名 |
| `description` | 何をするか・いつ使うか |
| `disable-model-invocation` | Claudeの自動選択を無効化する（明示呼び出しのみにする） |
| `allowed-tools` | そのスキル内で使えるツールを制限する |

`allowed-tools` を絞ると、たとえば「読み取りだけで書き込みはさせない」レビュー専用スキルのように、安全な範囲で動くスキルを作れます。

---

## 作り方の手順

実際に1つ作る流れはこうです。

```
スキルを作る手順
 ├─ ① .claude/skills/<スキル名>/ フォルダを作る
 ├─ ② その中に SKILL.md を置く
 ├─ ③ frontmatter に description（いつ使うか込み）を書く
 ├─ ④ 本文に「やってほしい手順」を具体的に書く
 └─ ⑤ 実際にその場面を作って、ちゃんと呼ばれるか確認する
```

最初のスキルは、**自分が一番よく繰り返している指示**を選ぶのがおすすめです。「コミットメッセージを書かせる」「差分をレビューさせる」など、頻度の高いものほど効果を実感できます。

---

## description の書き方が肝

スキルがうまく自動選択されない原因のほとんどは、`description` が曖昧なことです。コツは「**何をするか**」に加えて「**どんなときに使うか**」を具体的に書くことです。

```
良い例:
"差分をレビューしてリスクを指摘する。
 ユーザーが変更点を確認したいとき、コミットメッセージが欲しいとき、
 diffのレビューを頼んだときに使う"

惜しい例:
"コードをレビューする"   ← いつ使うかが曖昧で、選ばれにくい
```

「Use when ...（〜のときに使う）」のパターンで、トリガーになる場面を書き出すと、適切なタイミングで読み込まれやすくなります。

---

## 置き場所による使い分け

スキルは置き場所で適用範囲が変わります。

| 置き場所 | 適用範囲 |
|---|---|
| `~/.claude/skills/` | 自分の全プロジェクトで使える（個人用） |
| プロジェクト内の `.claude/skills/` | そのプロジェクト限定（チーム共有も可） |

「どこでも使う汎用スキル」は個人用に、「このプロジェクト固有の手順」はプロジェクト内に、と分けると整理しやすいです。プロジェクト内に置いてリポジトリに含めれば、チームで同じスキルを共有できます。

---

## まとめ

- スキルは `SKILL.md` 1ファイルで作れる（フロントマターの `description` + 本文）
- `description` には「何をするか」だけでなく「**いつ使うか**」を書くのが肝
- `!`...`` 記法でコマンド結果を取り込め、`allowed-tools` で使えるツールを絞れる
- 置き場所（個人用 / プロジェクト用）で適用範囲を使い分けられる

まずは**自分が一番よく繰り返している指示を1つ**スキル化してみてください。`description` を丁寧に書くだけで、毎回打っていた指示が「必要なときに自動で呼ばれる部品」に変わります。

---

## 補足: そのまま読める実例つきの無料リポジトリ

スキルを書く際は、よくできた実例があると形をつかみやすいです。私が実際に使っているスキルを無料で公開しています。

**無料スターター（GitHub・CC BY 4.0）:**
https://github.com/noguso245-jpg/claude-code-skills-starter

CLAUDE.md設計・計画ファースト開発（PIV）・AIコミット戦略・アジャイルなプロンプト設計の4本のスキルが日本語・英語で入っています。スキルの書き方の実例として中身を読み、自分用のスキルを作る参考にできます。まずは無料リポジトリから試してみてください。

---

最新のTipsはXでも発信しています: [@k___n___t_1125](https://x.com/k___n___t_1125)
