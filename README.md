# qiita-content

Qiita の技術記事を **git push で自動公開**するためのリポジトリ。

> 注: 当初 Zenn にも対応していたが、Zenn アカウントが BAN されたため Qiita 専用に変更（2026-06-02）。

```
public/     ← Qiita 記事（GitHub Actions + qiita-cli で push 時に自動公開）
.github/workflows/publish-qiita.yml  ← Qiita 自動公開ワークフロー
qiita.config.json
package.json  ← ローカルプレビュー用（@qiita/qiita-cli）
```

## 公開の仕組み

| プラットフォーム | 公開トリガー | 必要な初回設定 |
|---|---|---|
| Qiita | `public/*.md` を main に push | GitHub Secrets に `QIITA_TOKEN` を登録（1回だけ） |

## 初回セットアップ（1回だけ）

1. https://qiita.com/settings/applications で「個人用アクセストークン」を発行（スコープ: `read_qiita` `write_qiita`）
2. リポジトリの Settings → Secrets and variables → Actions → New repository secret
   - Name: `QIITA_TOKEN`
   - Secret: 発行したトークン
3. もしくは CLI で:
   ```
   gh secret set QIITA_TOKEN --repo noguso245-jpg/qiita-content
   ```

登録後、ワークフローを再実行（または `public/` を更新して push）すると公開される。

## 新規記事の追加

```bash
npx qiita new <basename>   # public/ にひな形生成 → 編集 → push
```

push すると Qiita に自動反映される。

## ローカルプレビュー

```bash
npm install
npm run qiita:preview
```
