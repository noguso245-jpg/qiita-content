---
title: Claude Code が遅い・重い時の対処法 — コンテキスト管理の実践ガイド
tags:
  - パフォーマンス
  - MCP
  - 生成AI
  - ClaudeCode
  - トークン最適化
private: false
updated_at: '2026-06-25T12:02:22+09:00'
id: f7a1a05b06b5e72345e5
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

大規模プロジェクトで Claude Code を使うエンジニアなら、誰もが経験したことがあるはずだ。「なぜか応答が遅くなってきた」「トークンが枯渇している」——こうした症状は、多くの場合 **コンテキスト窓の圧迫** が原因だ。

Claude Code の大きなコンテキスト窓は、一見余裕があるように見えるが、複雑なプロジェクトを進めるには思ったより早く埋まる。そして一度埋まると、古いコンテキストが失われて品質が低下する。

この記事では、公式ドキュメントで確認できる対処法を、実装可能なレベルで解説する。

## パフォーマンス低下の主な原因

### 1. .claudeignore の未設定（最頻出）

**症状：** プロジェクトのセットアップ直後からすぐ遅くなる。

多くの開発者は `.gitignore` は作るが `.claudeignore` を作らない。その結果、Claude が以下をコンテキストに読み込んでしまう：

```
node_modules/          → 数万ファイル
package-lock.json      → 数千行
.next/, dist/, build/  → 生成物
coverage/, .venv/      → テスト・仮想環境
```

**解決策：** プロジェクトルートに `.claudeignore` を置く。

### 2. セッション中の累積コンテキスト（長時間セッション）

**症状：** セッション序盤は快適だが、時間経過とともに遅くなる。

会話履歴が蓄積し、コンテキスト使用率が高くなると品質低下が加速する。

**解決策：** 自然なタスク区切りで `/compact` を実行。

### 3. MCP ツール定義の膨張（複数 MCP サーバー接続時）

**症状：** Slack/GitHub/Jira など複数の MCP を接続しているときに重い。

MCP ツール定義がコンテキストを圧迫する。

**解決策：** ツール定義の遅延ロードを活用し、ツール名を最適化し、不要なサーバーを切る。

---

## 【対策1】.claudeignore の設定（即効性が高い）

効果は即座・一度きり・コンテキスト定義量の削減。多くの場合これだけで改善する。

### テンプレート

```gitignore
# === Node.js ===
node_modules/
package-lock.json
yarn.lock
pnpm-lock.yaml
.next/
.nuxt/
dist/
build/
out/
coverage/

# === ログ・一時ファイル ===
*.log
logs/
tmp/
temp/

# === Python ===
__pycache__/
*.pyc
.venv/
venv/

# === 環境変数（セキュリティ） ===
.env*
*.secret

# === キャッシュ ===
.turbo/
.cache/
.parcel-cache/

# === 生成物・最小化ファイル ===
*.min.js
*.min.css
*.map
```

### 確認手順

```bash
# Step 1: .claudeignore を置く（上のテンプレートをコピペ）

# Step 2: Claude Code で /context を実行し、
# 設定前後でコンテキスト使用量が削減されたか確認する
```

削減幅はプロジェクト規模・言語・フレームワークにより異なります（巨大な node_modules を抱えるプロジェクトほど効果が大きい傾向）。

---

## 【対策2】/compact によるコンテキスト圧縮

セッションが長くなると会話履歴が蓄積して品質低下が起きる。これを `/compact` で圧縮する。

### /compact の実行タイミング

```
✅ 実行すべき場面：
  - コンテキスト使用率が高くなってきた
  - タスクが大きく切り替わった（A機能完了 → B機能開始）

❌ してはいけない場面：
  - 実装の途中（プランが失われる可能性）
```

### 実装手順

```bash
# Step 1: 現在のコンテキスト状況を把握
/context

# Step 2: 重要な設計決定を残したい場合は、
# メモやファイルに控えてから実行（任意）

# Step 3: コンテキストを圧縮
/compact
```

### /compact 実行後に何が保持されるか

公式ドキュメント（[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works.md)）によると、compaction では会話履歴が要約され、システムプロンプト・CLAUDE.md・メモリは再ロードされます。

| 保持されやすい | 失われやすい |
|-----------|------------|
| ✅ ファイルパス・プロジェクト構造 | ❌ 細かい中間決定（なぜこう実装したか） |
| ✅ 最近のコード変更 | ❌ 早期段階での仕様検討ログ |
| ✅ プロジェクト CLAUDE.md（自動再ロード） | ❌ セッション初期のやり取り |
| ✅ 直近の会話 | ❌ 中間状態の診断結果全文 |

**ポイント：** `/compact` 後に CLAUDE.md やメモリを読み直す追加コマンドは不要です（自動で再ロードされます）。

---

## 【対策3】MCP ツール定義の効率化

複数の MCP サーバー（Slack・GitHub・Jira など）を接続していると、ツール定義だけで大きなトークンを消費することがあります。

### ツール定義の仕組み

公式ドキュメント（[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works.md)）では、ツール定義が遅延ロード（deferred）され、必要なものだけ検索して読み込む仕組みが説明されています。ツール名は軽量に常時保持され、実体の定義は必要時に検索されます。

### 現状診断

```bash
/context
# ツール定義がどれだけトークンを使っているか確認できる
```

### ツール名・説明文の最適化（検索精度向上）

ツール検索が有効でも、ツール名が曖昧だと検索に失敗しやすくなります。自作 MCP サーバーを持つ場合は、以下を意識します。

```javascript
// ❌ 悪い例（曖昧）
{ "name": "action", "description": "Perform an action" }

// ✅ 良い例（検索に引っかかりやすい）
{
  "name": "github_list_pull_requests",
  "description": "List open pull requests for a repository. Returns PR number, title, author, created date, and status."
}
```

ベストプラクティス：

1. **動詞 + 対象** の形式にする（`get_user` ○ / `user` ✗）
2. 説明文に「何ができるか」「戻り値は何か」を明記する
3. 同じ機能の別名を避け、統一する

### 不要な MCP サーバーの選別

```bash
/mcp
# 接続中の MCP サーバーを確認し、使っていないものは設定から外す
```

`~/.claude/settings.json` または `.claude/settings.json` の MCP 設定から、使用していないサーバーを削除します。

---

## 【補足】LSP 統合でのシンボル検索（Claude Code 2.0.74+ のオプション機能）

Claude Code 2.0.74 以降では、LSP（Language Server Protocol）統合により、対応言語（TypeScript・Python・Rust・Go 等）でのシンボル検索を補助できます。これは **オプション機能** で、必須ではありません。プロジェクトに LSP が入っていれば活用される、という位置づけです（過度に依存しない）。

---

## 実践チェックリスト

### プロジェクトセットアップ時（最初の1回）

- [ ] `.claudeignore` を作成・`/context` で削減を確認
- [ ] 不要な MCP サーバーを外した

### セッション中（定期的に）

- [ ] `/context` でコンテキスト使用率を確認
- [ ] 使用率が高くなったら、区切りで `/compact`

---

## よくある質問

**Q: /compact と /clear の使い分けは？**

- `/compact`：会話履歴を圧縮しつつタスク継続。CLAUDE.md・メモリは自動再ロード。
- `/clear`：すべてクリアして新規スタート。次のタスクが全く異なる場合に。

**Q: .claudeignore を書き換えたのに反映されない？**

- 起動時に読み込まれます。変更後は新しいセッションで反映されます。

**Q: /prime コマンドは？**

- これは公式コマンドではなく、コミュニティで作られたスキルです（プロジェクト情報を読み込む補助）。使う場合は別途セットアップが必要です。

---

## まとめ

Claude Code のパフォーマンス低下は「ツールの問題」ではなく「コンテキスト管理の問題」であることが多い。

1. **.claudeignore** ← 最優先・即効
2. **/compact + /context** ← 長時間セッションの品質維持
3. **MCP ツール最適化** ← 複数サーバー接続時

---

## 無料リポで関連スキルも配布中（CC BY 4.0）

本記事の設定はそのままコピペして使えます。あわせて無料リポ **skills-starter** では、実用スキル4本（claude-md-architecture / piv-development-loop / ai-commit-strategy / agile-prompt-template）＋ CLAUDE.md テンプレート＋ pre-commit hook を配布しています。

1. リポを開く → https://github.com/noguso245-jpg/claude-code-skills-starter
2. `skills/ja/` の該当スキル .md をコピーして自分のプロジェクトで使う
3. 役立ったら ⭐ Star を（同じように探している人に見つけてもらいやすくなります。更新を追うなら Watch）

参考：
- [How Claude Code works - Context Window](https://code.claude.com/docs/en/how-claude-code-works.md)
- [Commands](https://code.claude.com/docs/en/commands.md)
