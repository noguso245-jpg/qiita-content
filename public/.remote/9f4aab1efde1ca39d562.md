---
title: Claude Code Hooksで「AIによる事故」をゼロにする完全設定ガイド
tags:
  - AI
  - ClaudeCode
private: false
updated_at: '2026-05-26T21:49:11+09:00'
id: 9f4aab1efde1ca39d562
organization_url_name: null
slide: false
ignorePublish: false
---
「AIがうっかり.envを書き換えた」「コストが気づいたら$200超えていた」

Claude Codeを使っていれば、こういう事故のリスクは常にあります。

この記事では、**Hooks機能**を使ってこれらの事故を完全に防ぐ設定方法を解説します。

---

## Hooksとは何か

HooksはClaude Codeの設定機能で、「何かが起きたときに自動でコマンドを実行する」仕組みです。

```
Claude Codeが何かをしようとする
         ↓
Hookが発火
         ↓
指定したコマンドが実行される
         ↓
OKなら続行 / NGならブロック
```

設定は `.claude/settings.json` に書きます。

---

## 基本構造

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "ツール名",
        "hooks": [
          {
            "type": "command",
            "command": "実行するコマンド"
          }
        ]
      }
    ]
  }
}
```

`PreToolUse` は「ツールを使う前」に発火するフックです。
戻り値が非ゼロ（エラー）だと、そのツールの実行がブロックされます。

---

## Hook 1: .envファイル保護（最重要）

Claude Codeが `.env` ファイルを書き換えようとしたときに自動ブロックします。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"\nimport sys, json\ntry:\n    data = json.load(sys.stdin)\n    path = data.get('path', '')\n    if '.env' in path and not path.endswith('.example'):\n        print(f'BLOCKED: .env write attempt to {path}', file=sys.stderr)\n        sys.exit(1)\nexcept: pass\n\""
          }
        ]
      }
    ]
  }
}
```

これを設定すると、Claude Codeが `.env` に書き込もうとした瞬間にエラーになります。

---

## Hook 2: コスト超過アラート

APIコストが設定した金額を超えたらセッションを自動停止します。

`--max-budget-usd` フラグと組み合わせて使います：

```bash
claude --max-budget-usd 5
```

このフラグだけで $5 超過時に自動停止します。

さらに、Hooksで警告を出す場合：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'cost=$(claude cost 2>/dev/null || echo 0); if (( $(echo \"$cost > 4\" | bc -l) )); then echo \"WARNING: Cost is $cost USD\" >&2; fi'"
          }
        ]
      }
    ]
  }
}
```

---

## Hook 3: Lint自動実行

ファイルを保存するたびに自動でlintが走り、エラーがあればコミットを止めます。

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'file=$(echo $CLAUDE_TOOL_OUTPUT | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d.get(\\\"path\\\",\\\"\\\"))\" 2>/dev/null); if [[ -n \"$file\" && (\"$file\" == *.ts || \"$file\" == *.tsx || \"$file\" == *.js) ]]; then npx eslint \"$file\" --max-warnings 0; fi'"
          }
        ]
      }
    ]
  }
}
```

---

## 実用的な完全設定（コピー可）

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/security-guard.py"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/bash-guard.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.claude/hooks/lint-on-save.sh"
          }
        ]
      }
    ]
  }
}
```

---

## security-guard.py の内容

`.claude/hooks/security-guard.py` として保存：

```python
import sys
import json

BLOCKED_PATHS = ['.env', '.env.local', '.env.production']
BLOCKED_PATTERNS = ['password', 'secret', 'token', 'api_key']

try:
    data = json.load(sys.stdin)
    path = data.get('path', '')
    
    # .envファイルへの書き込みをブロック
    for blocked in BLOCKED_PATHS:
        if path.endswith(blocked):
            print(f'BLOCKED: Attempted to write to {path}', file=sys.stderr)
            sys.exit(1)
    
    # ファイル内容にシークレットが含まれる場合は警告
    content = data.get('content', '')
    for pattern in BLOCKED_PATTERNS:
        if pattern in content.lower() and 'example' not in path:
            print(f'WARNING: Content contains "{pattern}" - verify this is intentional', file=sys.stderr)

except Exception:
    pass  # エラーは無視して続行
```

---

## セットアップ手順

```bash
# 1. hooksディレクトリを作成
mkdir -p .claude/hooks

# 2. security-guard.pyを配置
# （上記のコードを .claude/hooks/security-guard.py として保存）

# 3. settings.jsonを作成/更新
# （上記の完全設定をコピー）

# 4. 動作確認
claude
# → .envに書き込もうとするとブロックされる
```

---

## まとめ

| Hook | 防げる事故 |
|---|---|
| .env保護 | 認証情報の誤上書き |
| コスト管理 | 高額請求 |
| Lint自動実行 | CI失敗 |

3つのHookで、Claude Codeを使ったほぼすべての重大事故を防げます。

---

## 無料テンプレート配布中

上記のHooks設定ファイル一式を無料配布しています。

**GitHub（無料）:**
https://github.com/noguso245-jpg/claude-code-starter

**BOOTH（完全設定セット ¥1,480）:**
https://streamsolty.booth.pm/items/8413811

5種類のHooks設定 + settings.json + マージ手順書が含まれます。

**完全版（Hooks + 53スキル + MCP + ¥9,800）:**
https://streamsolty.booth.pm/items/8413724

---

**X（最新情報）:** [@k___n___t_1125](https://x.com/k___n___t_1125)
