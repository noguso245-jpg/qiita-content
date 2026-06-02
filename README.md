# zenn-qiita-content

Zenn と Qiita の技術記事を **1リポジトリ・git push で自動公開**するためのリポジトリ。

```
articles/   ← Zenn 記事（Zenn の GitHub 連携で push 時に自動デプロイ）
public/     ← Qiita 記事（GitHub Actions + qiita-cli で push 時に自動公開）
.github/workflows/publish-qiita.yml  ← Qiita 自動公開ワークフロー
qiita.config.json
package.json  ← ローカルプレビュー用（zenn-cli / @qiita/qiita-cli）
```

## 公開の仕組み

| プラットフォーム | 公開トリガー | 必要な初回設定 |
|---|---|---|
| Zenn | `articles/*.md` を main に push | Zenn ダッシュボードで本リポを GitHub 連携（1回だけ） |
| Qiita | `public/*.md` を main に push | GitHub Secrets に `QIITA_TOKEN` を登録（1回だけ） |

## 初回セットアップ（1回だけ）

### 1. Zenn と GitHub を連携

1. https://zenn.dev/dashboard/deploys を開く
2. 「リポジトリを連携する」→ GitHub アプリを承認 → `noguso245-jpg/zenn-qiita-content` を選択
3. 連携後、`articles/` 内の `published: true` の記事が自動デプロイされる

### 2. Qiita トークンを GitHub Secret に登録

1. https://qiita.com/settings/applications で「個人用アクセストークン」を発行（スコープ: `read_qiita` `write_qiita`）
2. リポジトリの Settings → Secrets and variables → Actions → New repository secret
   - Name: `QIITA_TOKEN`
   - Secret: 発行したトークン
3. もしくは CLI で:
   ```
   gh secret set QIITA_TOKEN --repo noguso245-jpg/zenn-qiita-content
   ```

## 新規記事の追加

```bash
# Zenn
npx zenn new:article   # articles/ にひな形生成 → 編集 → published: true で push

# Qiita
npx qiita new <basename>   # public/ にひな形生成 → 編集 → push
```

push すると、それぞれのプラットフォームに自動反映される。

## ローカルプレビュー

```bash
npm install
npm run zenn:preview    # http://localhost:8000
npm run qiita:preview
```
