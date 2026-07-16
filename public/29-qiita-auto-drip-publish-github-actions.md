---
title: >-
  この記事は自動投稿されています — git pushだけでQiitaに毎日1本ずつ記事を公開する仕組み（GitHub Actions ×
  qiita-cli）
tags:
  - Qiita
  - 自動化
  - CICD
  - GitHubActions
  - qiita-cli
private: false
updated_at: '2026-07-16T14:47:55+09:00'
id: 4820b56996cb0461a719
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

この記事、実は**人間がQiitaの投稿ボタンを押していません**。

リポジトリの `queue/` フォルダにMarkdownを積んでおいたら、今日のお昼にGitHub Actionsが勝手に1本取り出して、勝手に公開しました。私がやったのは、何日か前に `git push` しただけです。

技術記事を書いている人なら、こんな経験はないでしょうか。

- **記事の下書きは溜まっているのに、「投稿する」という最後の一手が面倒で止まる**
- 勢いで書き溜めた記事を一気に投稿したら、連続投稿でタイムラインを埋めてしまい気まずい
- 「毎日1本ずつ出そう」と決めても、手動だと3日で忘れる

この記事では、この3つをまとめて解決する「**git pushだけで、毎日1本ずつQiitaに自動公開される仕組み**」を、実際に動いているワークフローをもとに解説します。

**この記事で分かること**

1. qiita-cli（Qiita公式）で「pushしたら公開」を実現する基本形
2. 一気に公開せず「毎日1本ずつ」に絞るドリップ配信の実装（GitHub Actions）
3. 公開順の制御・即時公開との使い分け・トークン設定などの運用の要点

---

## 土台: qiita-cli で「pushしたら公開」

まず土台になるのが、Qiita公式の [qiita-cli](https://github.com/increments/qiita-cli) です。これを使うと、**GitHubリポジトリにMarkdownをpushするだけで記事を公開**できます。

記事ファイルは、先頭にこんなフロントマターを持つMarkdownです。

```yaml
---
title: '記事タイトル'
tags:
  - Qiita
private: false
updated_at: ''
id: null            # ← ここが null なら「新規記事」の合図
organization_url_name: null
slide: false
ignorePublish: false
---
```

ポイントは `id: null` です。**`id` が `null` のファイルは新規記事として投稿され、公開後にqiita-cliが発行された記事IDをこのフィールドに書き戻してコミットしてくれます**。以降そのファイルを編集してpushすれば、同じ記事の「更新」になります。

pushで公開する側のワークフローは、公式アクションを呼ぶだけの短いものです。

```yaml
# .github/workflows/publish-qiita.yml（簡略版）
name: Publish Qiita articles

on:
  push:
    branches: [main]
    paths:
      - "public/**"   # public/ 配下が変わったときだけ動く

jobs:
  publish_articles:
    runs-on: ubuntu-latest
    permissions:
      contents: write   # 記事IDの書き戻しコミットに必要
    steps:
      - uses: actions/checkout@v4
      - uses: increments/qiita-cli/actions/publish@v1
        with:
          qiita-token: ${{ secrets.QIITA_TOKEN }}
          root: "."
```

これだけで「`public/` にMarkdownを置いてpushすると公開される」が成立します。

## 問題: 書き溜めた記事を一気にpushすると危ない

ここで罠があります。この構成のまま、書き溜めた記事を10本まとめて `public/` にpushすると、**10本が短時間に連続投稿されます**。

読者から見れば同一ユーザーの記事がタイムラインに連続で並ぶ状態で、**スパム的な投稿と判定されるリスク**があります。せっかく書いた記事の置き場を失っては本末転倒です。

つまり欲しいのは「pushは好きなときにまとめて、**公開だけは毎日1本ずつ**」という挙動です。これを `queue/` フォルダとスケジュール実行のGitHub Actionsで実現します。

## 解決: queue/ + cron の「ドリップ公開」

### 全体像

リポジトリの構成はこうなります。

```text
qiita-content/
├── public/                        # Qiitaと同期される記事置き場
│   ├── 01-first-article.md        # 公開済み（idに記事IDが書き戻される）
│   └── ...
├── queue/                         # 公開待ちの記事置き場
│   ├── 07-next-article.md         # ← 明日はこれが公開される（昇順の先頭）
│   ├── 08-another-article.md
│   └── ...
└── .github/workflows/
    ├── publish-qiita.yml          # pushトリガー: public/ の変更を即公開
    └── drip-publish.yml           # cronトリガー: 毎日1本 queue → public
```

流れは次の4ステップです。

1. 記事を `queue/` に `NN-slug.md`（連番プレフィックス）で積んでpushしておく
2. 毎日1回、cronでワークフローが起動する
3. `queue/` をファイル名でソートして**先頭の1本だけ**を `public/` へ `git mv` し、qiita-cliで公開する
4. 移動をコミットしてpushする（queueが1本減る）

これを毎日繰り返すので、queueに10本積んであれば10日かけて1本ずつ公開されていきます。

### ワークフロー本体

実際に動いているものを簡略化したのがこちらです。

```yaml
# .github/workflows/drip-publish.yml（簡略版）
name: Drip publish (1 queued article per day)

on:
  schedule:
    - cron: "13 3 * * *"   # cronはUTC指定。03:13 UTC = 12:13 JST
  workflow_dispatch: {}     # 手動実行もできるようにしておく

permissions:
  contents: write

jobs:
  drip:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # 1) queue/ の先頭1本を選ぶ（ファイル名の昇順）
      - name: Pick next queued article
        id: pick
        shell: bash
        run: |
          shopt -s nullglob
          files=(queue/*.md)
          if [ ${#files[@]} -eq 0 ]; then
            echo "Queue is empty — nothing to publish."
            echo "empty=1" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          next=$(printf '%s\n' "${files[@]}" | LC_ALL=C sort | head -n1)
          echo "next=$next" >> "$GITHUB_OUTPUT"
          echo "base=$(basename "$next")" >> "$GITHUB_OUTPUT"

      # 2) public/ へ移動（= 公開対象にする）
      - name: Move queued article into public/
        if: steps.pick.outputs.empty != '1'
        run: git mv "${{ steps.pick.outputs.next }}" "public/${{ steps.pick.outputs.base }}"

      # 3) qiita-cli 公式アクションで公開
      - name: Publish to Qiita
        if: steps.pick.outputs.empty != '1'
        uses: increments/qiita-cli/actions/publish@v1
        with:
          qiita-token: ${{ secrets.QIITA_TOKEN }}
          root: "."

      # 4) 移動をコミットしてpush
      - name: Commit queue move
        if: steps.pick.outputs.empty != '1'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          git diff --cached --quiet || git commit -m "drip-publish: ${{ steps.pick.outputs.base }}"
          git push
```

### 実装の小さなこだわり

**queueが空でも正常終了する**。`shopt -s nullglob` がないと、`queue/*.md` にマッチするファイルが無いときglobが文字列のまま残って配列が「1件」になってしまいます。nullglobで空配列にしておき、0件なら「Queue is empty」とログを出して `exit 0`。在庫切れはエラーではなく平常運転です。

**選択は `sort | head -n1` だけ**。凝った優先度管理はせず、ファイル名の昇順で先頭を取るだけにしています。`LC_ALL=C` を付けてソート順がロケールに左右されないようにしています。

**公開順はファイル名で制御できる**。`07-xxx.md`、`08-yyy.md` のように連番プレフィックスを付けておけば、公開順=連番順になります。順番を差し替えたければ、リネームしてpushするだけです。

**急ぎの記事は queue を通さなくていい**。即時公開したい記事は最初から `public/` に置いてpushすれば、pushトリガー側のワークフロー（`publish-qiita.yml`）が反応してすぐ公開されます。「平常はドリップ、緊急は直置き」の二段構えです。

### QIITA_TOKEN の設定

qiita-cliの公式アクションに渡すトークンは、Qiitaの設定画面で発行した**個人用アクセストークン**（スコープは `read_qiita` と `write_qiita`）を使います。

これをリポジトリの **Settings → Secrets and variables → Actions** に `QIITA_TOKEN` という名前で登録し、ワークフローからは `${{ secrets.QIITA_TOKEN }}` で参照します。**トークンの値そのものをYAMLや記事に書かない**こと。Secretsに入れておけばログにもマスクされて出力されます。

## まとめ

- **qiita-cli**（Qiita公式）を使うと、GitHubリポジトリへのpushだけで記事を公開できる。`id: null` が新規記事の合図で、公開後にqiita-cliが記事IDをファイルへ書き戻してくれる
- 書き溜めた記事を一気にpushすると連続投稿になり**スパム判定のリスク**があるため、`queue/` + cronのGitHub Actionsで「**毎日1本ずつ**」公開するドリップ方式にした
- 仕組みは「`sort` で先頭1本を選ぶ → `public/` へ `git mv` → qiita-cliで公開 → コミットをpush」だけ。queueが空なら「Queue is empty」を出して正常終了する
- 連番プレフィックスで公開順を制御でき、急ぎの記事は `public/` 直置きで即時公開もできる

そして冒頭に書いたとおり、**この記事自体が `queue/` に積まれ、この仕組みによって自動公開されたものです**。あなたがこれを読めているということは、今日もcronが正しく動いた、ということになります。

記事の在庫はあるのに投稿の一手が面倒で止まっている方は、まず「pushで公開」の土台から試してみてください。書く作業と出す作業を切り離せると、書くほうに集中できるようになります。
