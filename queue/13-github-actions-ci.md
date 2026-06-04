---
title: Claude Code を GitHub Actions に組み込む — PRレビューと定型作業を CI で自動化する
tags:
  - ClaudeCode
  - AI
  - 生成AI
  - GitHubActions
  - CI
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

Claude Codeは手元のターミナルで使うものだと思われがちですが、**GitHub Actions に組み込んで CI の中で動かす**こともできます。これができると、こんなことが自動化できます。

- プルリクエストに `@claude` とコメントすると、Claudeが対応してくれる
- PRが作られるたびに、自動でコードレビューが走る
- 毎朝決まった時刻に、前日のコミットや課題のサマリを生成する

この記事では、公式の `claude-code-action` を使った組み込み方を、最小構成から実用例までまとめます。

> 注意: GitHub Actions連携のアクション名・入力パラメータは変わることがあります。本記事は執筆時点（2026年6月）の公式ドキュメントを参照していますが、導入時は手元の最新ドキュメントで確認してください。また、CI上でClaudeを動かすと**APIの利用料金が発生します**。トリガー条件・実行回数・モデルはコストを意識して設計してください。

---

## 仕組み: 公式アクション `anthropics/claude-code-action` を使う

GitHub ActionsでClaude Codeを動かすには、公式の `anthropics/claude-code-action@v1` をワークフローに追加します。APIキーはGitHubのSecretとして渡します。

基本形は次のとおりです。

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    prompt: "Your instructions here" # 任意
    claude_args: "--max-turns 5"     # 任意（CLI引数）
```

- `anthropic_api_key`: APIキー。リポジトリのSecretに `ANTHROPIC_API_KEY` として登録して渡す
- `prompt`: Claudeへの指示（省略可。コメント駆動の場合は無くてもよい）
- `claude_args`: Claude CodeのCLI引数（`--max-turns` や `--model` など）

---

## 事前準備: APIキーを Secret に登録する

ワークフローからAPIキーを直接書くのは厳禁です。GitHubリポジトリの **Settings → Secrets and variables → Actions** で `ANTHROPIC_API_KEY` を登録し、ワークフローからは `${{ secrets.ANTHROPIC_API_KEY }}` で参照します。

> 注意: APIキーをワークフローファイルやログに平文で出さないこと。Secret経由でのみ渡してください。

---

## 例1: コメントで `@claude` を呼ぶ

一番シンプルなのが、Issueコメントやレビューコメントで `@claude` とメンションしたら反応する構成です。公式ドキュメントの最小例です。

```yaml
name: Claude Code
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
jobs:
  claude:
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          # コメント内の @claude メンションに反応する
```

これを入れておくと、PRやIssueのコメントで「@claude このバグの原因を調べて」のように声をかけるだけで、CI上のClaudeが動きます。手元を離れていてもブラウザから指示できるのが利点です。

---

## 例2: PRが作られたら自動でレビューする

プルリクエストのオープン・更新をトリガーにして、自動レビューを走らせる構成です。公式ドキュメントには、プラグインのスキルを呼ぶ例があります。

```yaml
name: Code Review
on:
  pull_request:
    types: [opened, synchronize]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          plugin_marketplaces: "https://github.com/anthropics/claude-code.git"
          plugins: "code-review@claude-code-plugins"
          prompt: "/code-review:code-review ${{ github.repository }}/pull/${{ github.event.pull_request.number }}"
```

- `on: pull_request` の `opened` / `synchronize`: PR作成時とコミット追加時に発火
- `plugins`: レビュー用スキルを読み込む
- `prompt`: そのスキルをPR番号付きで呼び出す

PRごとに自動でレビューコメントが付く運用になります。ただし**全PRで毎回走るとコストが積み上がる**ので、対象ブランチやラベルで絞ることを検討してください。

---

## 例3: 毎朝サマリを生成する（スケジュール実行）

`schedule` トリガーを使うと、cronで定期実行できます。公式ドキュメントの例です。

```yaml
name: Daily Report
on:
  schedule:
    - cron: "0 9 * * *"
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: "Generate a summary of yesterday's commits and open issues"
          claude_args: "--model opus"
```

`cron: "0 9 * * *"` で毎日特定時刻に実行されます（GitHub ActionsのcronはUTC基準なので、日本時間で動かしたい時刻に合わせてずらす点に注意）。「前日のコミットとオープンIssueのサマリを作る」といった定型レポートに向きます。

---

## 設計のコツ: コストとトリガーを意識する

CI上でClaudeを動かすと、実行のたびにAPI利用料が発生します。気持ちよく自動化するほど料金も積み上がるので、最初から線引きを決めておくと安心です。

| 観点 | 考え方 |
|---|---|
| トリガーを絞る | 全PR/全コミットで走らせず、ラベルや対象ブランチで限定する |
| ターン数を制限 | `claude_args: "--max-turns N"` で暴走を防ぐ |
| モデルを使い分ける | 軽い定型作業は軽量モデル、重い作業だけ高性能モデルに |
| まず手動で検証 | 自動トリガーにする前に、`workflow_dispatch` 等で手動実行して挙動を確認 |

特に**ターン数の上限**は安全弁として有効です。想定外に長く動いて料金とCI時間を食う事故を防げます。

---

## まとめ

- 公式アクション `anthropics/claude-code-action@v1` でGitHub Actionsに組み込める
- APIキーは必ずSecret（`ANTHROPIC_API_KEY`）経由で渡す
- 主な使い方は ①コメントで `@claude` ②PR自動レビュー ③スケジュールでの定期レポート
- CIで動かすとAPI料金が発生する。トリガー・ターン数・モデルでコストを管理する

まずは**「コメントで `@claude` を呼べる」最小構成**から入れて、挙動と料金感をつかんでから、自動レビューやスケジュール実行に広げるのが安全です。

---

## 補足: 自動化の前提を整える無料リポジトリ

CIに任せる作業ほど、`CLAUDE.md` でルールを明文化し、レビュー観点や進め方を型にしておくと、自動実行でも一貫した品質を保ちやすくなります。私が使っているスキルを無料で公開しています。

**無料スターター（GitHub・CC BY 4.0）:**
https://github.com/noguso245-jpg/claude-code-skills-starter

CLAUDE.md設計・計画ファースト開発（PIV）・AIコミット戦略・アジャイルなプロンプト設計の4本のスキルが日本語・英語で入っています。CI連携の前に、人間がレビューする運用で型を固めておくとスムーズです。まずは無料リポジトリから試してみてください。

---

最新のTipsはXでも発信しています: [@k___n___t_1125](https://x.com/k___n___t_1125)
