---
title: Git worktreeでClaude Codeを安全に並列で走らせる — 1リポ複数作業のブランチ衝突回避と実務手順
tags:
  - Git
  - AI
  - 個人開発
  - 生成AI
  - ClaudeCode
private: false
updated_at: '2026-06-04T10:46:53+09:00'
id: 9b666dec4c0f11594a14
organization_url_name: null
slide: false
ignorePublish: false
---

Claude Codeを複数同時に走らせようとして、こうなった経験はありませんか。

- 1つのリポで2セッション動かしたら、片方が編集中のファイルをもう片方が上書きした
- 機能Aを実装中に「急ぎでバグ修正して」と言われ、作業を中断して `git stash` する羽目になった
- ブランチを切り替えた瞬間、別セッションのClaude Codeが「さっきまであったファイルが消えた」と混乱し始めた
- 結局、安全のために常に1セッションしか動かせず、待ち時間がもったいない

原因は「Claude Codeが賢くない」ことでも「並列が危険」なことでもありません。**同じ作業ディレクトリ（同じブランチ）を複数のセッションで共有している**ことが問題です。

これを解決するのが **`git worktree`** です。1つのリポジトリから物理的に別のフォルダ・別のブランチを切り出し、Claude Codeセッションごとに完全に独立した作業場所を与えます。

この記事では、worktreeを「コマンドは知ってるけど普段使ってない」状態から「Claude Code並列運用の標準装備」にするための、具体的な手順を実務目線でまとめます。すべて今日のリポジトリで試せます。

なお、並列運用の土台になるCLAUDE.md設計やコミット戦略などの関連スキルは、無料リポで配布しています（記事末にリンク）。

---

## なぜ「ブランチ切り替え」では並列にならないのか

まず誤解を解いておきます。「ブランチを分けてるんだから並列で走らせても大丈夫では？」という疑問です。

答えはNoです。理由はシンプルで、**`git checkout`（`git switch`）は作業ディレクトリそのものを書き換える**からです。

```
リポジトリ /myapp （作業ディレクトリは1つ）
 ├─ Claude セッションA: feature/login で作業中
 └─ Claude セッションB: 「fix/bug を見て」と checkout
     → /myapp の中身が一瞬で fix/bug の状態に変わる
     → セッションA から見ると、編集中だったファイルが別物に化ける
```

ブランチは「履歴の枝」ですが、その枝を映し出す**作業ディレクトリは1リポにつき1つ**です。ここに複数のセッションが同居すると、ブランチ切り替えのたびにお互いの足元が崩れます。

`git worktree` は、この「作業ディレクトリは1つ」という制約を外します。1つの `.git` を共有したまま、**ブランチごとに独立した物理フォルダ**を持てるようになります。

```
リポジトリ本体 /myapp        → main
worktree      /myapp-login   → feature/login
worktree      /myapp-bugfix  → fix/bug
```

それぞれが別フォルダなので、別フォルダで別のClaude Codeを起動すれば、互いに一切干渉しません。これが並列運用の土台です。

---

## 基本の3コマンドだけ覚える

worktreeはコマンドが多そうに見えますが、実務で使うのは実質3つです。

```bash
# 1. 新しいブランチ + worktree を同時に作る
git worktree add ../myapp-login -b feature/login

# 2. 今あるworktreeを一覧する
git worktree list

# 3. 作業が終わったworktreeを片付ける
git worktree remove ../myapp-login
```

`git worktree add ../myapp-login -b feature/login` の意味はこうです。

| 部分 | 意味 |
|---|---|
| `../myapp-login` | worktreeを置く**物理フォルダのパス**（リポジトリの外、親階層に置くのが定石） |
| `-b feature/login` | 新規ブランチ `feature/login` を作ってそこに紐づける |

既存ブランチに対してworktreeを作りたいときは `-b` を外します。

```bash
# 既存の fix/bug ブランチを別フォルダにチェックアウト
git worktree add ../myapp-bugfix fix/bug
```

`git worktree list` の出力はこうなります。今どのフォルダがどのブランチに紐づいているか一目で分かります。

```
/myapp          a1b2c3d [main]
/myapp-login    e4f5g6h [feature/login]
/myapp-bugfix   i7j8k9l [fix/bug]
```

覚えることは「**add で生やす、list で見る、remove で片付ける**」だけです。

---

## 実務フロー: 機能開発中に割り込みバグ修正が来た

worktreeの威力が一番分かるのが、この「割り込み」シナリオです。

**Before（worktreeなし・stash地獄）:**

```
1. feature/login を実装中（Claude Codeが3ファイル編集済み・未コミット）
2. 「本番でバグ。今すぐ直して」と割り込み
3. git stash で作業を退避
4. main に切り替え → fix/bug を切る → 修正 → コミット
5. feature/login に戻る → git stash pop
6. stash の競合解決でさらに時間を溶かす…
```

これは作業ディレクトリが1つしかないために起きる典型的な消耗です。Claude Codeで動かしていると、stash前後でコンテキストもズレて余計に混乱します。

**After（worktreeで割り込みを物理的に分離）:**

```bash
# feature/login の作業はそのまま放置でOK（触らない）
# 割り込み用に別フォルダのworktreeを生やす
git worktree add ../myapp-hotfix -b fix/login-crash main
```

あとは新しいフォルダ `../myapp-hotfix` で**別のClaude Codeセッションを起動**するだけです。

```bash
# 別ターミナルで
cd ../myapp-hotfix
claude
```

元の `feature/login` のフォルダとセッションは**1ミリも触っていない**ので、stashも競合解決も発生しません。バグ修正が終わったら worktree を消して、元の作業に戻るだけです。

```bash
# hotfix が終わってマージ済みなら片付ける
git worktree remove ../myapp-hotfix
```

| 観点 | Before（stash運用） | After（worktree運用） |
|---|---|---|
| 元の作業 | 退避が必要 | そのまま放置でOK |
| ブランチ切り替え | 必要（足元が崩れる） | 不要（別フォルダ） |
| Claude のコンテキスト | stash前後でズレる | 元セッションは維持される |
| 競合解決 | pop時に発生しがち | 発生しない |

---

## Claude Codeを2セッション並列で走らせる手順

ここからが本題の「並列運用」です。やることは難しくありません。**worktreeごとに1セッション**を割り当てるだけです。

### ステップ1: タスクごとにworktreeを切る

```bash
# 機能開発用
git worktree add ../myapp-feature -b feature/dashboard main

# テスト整備用
git worktree add ../myapp-tests -b chore/add-tests main
```

### ステップ2: それぞれのフォルダで別々にClaude Codeを起動する

```bash
# ターミナル1
cd ../myapp-feature
claude
# → 「ダッシュボード画面を実装して」

# ターミナル2
cd ../myapp-tests
claude
# → 「既存APIのテストを追加して」
```

2つのセッションは別フォルダ・別ブランチで動くので、**同じファイルを同時に編集してしまう事故が原理的に起きません**。片方がコミットしようがブランチを切り替えようが、もう片方には影響しません。

### ステップ3: 終わったら順にマージして片付ける

```bash
# 本体リポジトリに戻る
cd ../myapp

# それぞれの成果をマージ
git merge feature/dashboard
git merge chore/add-tests

# worktree を片付ける
git worktree remove ../myapp-feature
git worktree remove ../myapp-tests
```

ポイントは、**並列にしてよいのは「独立したタスク」だけ**だという点です。判断基準は次の通りです。

| 状況 | worktreeで並列にしてよいか |
|---|---|
| 機能Aとテスト整備（触るファイルが別） | ◯ 並列OK |
| 機能Aと、その機能Aのリファクタ | × 同じコードを奪い合う。逐次で |
| バグ修正と新機能（別領域） | ◯ 並列OK |
| 共通の型定義を両方が書き換える | × マージ時に必ず競合する |

「別フォルダなら衝突しない」のはあくまで**作業ディレクトリの話**です。最終的にマージする以上、論理的に同じコードを触るタスクは、worktreeを分けても結局マージで衝突します。物理分離と論理分離は別物だと意識してください。

---

## 複数セッションの使い分け: 役割でフォルダを固定する

worktreeを3つ4つと増やすと、今度は「どのフォルダで何をやっていたか」が分からなくなります。これを防ぐには、**フォルダ名に役割を埋め込んで固定運用**するのがおすすめです。

```
myapp/            ← main 専用（ここでは作業しない・統合とマージだけ）
myapp-feat/       ← 機能開発の常設worktree
myapp-fix/        ← バグ修正の常設worktree
myapp-exp/        ← 実験・お試し用（壊しても捨てればいい）
```

それぞれのフォルダに、用途に特化した `CLAUDE.md` を置いておくと、起動したClaude Codeが即座に「自分は何担当か」を把握できます。

```markdown
<!-- myapp-fix/CLAUDE.md の例 -->
# このworktreeの役割

- ここは「バグ修正専用」のworktreeです
- 新機能の追加はしないこと（feat worktree の担当）
- 修正は最小限の差分にとどめ、必ずテストを1つ足す
```

> ポイント: worktreeごとに役割を固定すると、Claude Codeへの指示も短くなります。毎回「これは修正タスクで…」と説明する必要がなくなり、フォルダに入った時点で文脈が決まります。

### 本体リポは「触らない場所」にする

地味に効くのが、**本体リポジトリ（`main`が出ているフォルダ）では直接作業しない**というルールです。本体は「各worktreeの成果をマージする統合専用の場所」と決めておくと、`main` を誤って汚す事故が減ります。Claude Codeのセッションも、原則worktree側でのみ起動します。

---

## ハマりやすい落とし穴と回避策

worktreeは便利ですが、いくつか定番の罠があります。先に知っておけば回避できます。

### 罠1: 同じブランチを2つのworktreeでチェックアウトできない

```bash
git worktree add ../myapp-2 main
# fatal: 'main' is already checked out at '/myapp'
```

Gitは仕様として、**1つのブランチは1つのworktreeにしか紐づけられません**。これはむしろ安全装置です。同じブランチを別フォルダで同時編集できてしまうと、それこそ衝突の温床になります。並列でやりたいなら、必ずブランチも分けてください。

### 罠2: node_modules や .env はworktree間で共有されない

worktreeは**作業ディレクトリのコピー**なので、`.gitignore` されているファイル（`node_modules/`、`.env`、ビルド成果物など）は新しいフォルダには**ありません**。新しいworktreeを作ったら、依存のインストールが別途必要です。

```bash
cd ../myapp-feature
npm install        # worktreeごとに必要
cp ../myapp/.env . # gitignoreされた設定は手動でコピー
```

これをClaude Codeのセットアップ手順としてworktreeの `CLAUDE.md` に書いておくと、起動直後に自動で整えてくれます。

### 罠3: worktreeフォルダを `rm -rf` で消すと参照が残る

フォルダだけ手で削除すると、Gitの管理情報に「壊れたworktree」が残り続けます。

```bash
# NG: フォルダだけ消す
rm -rf ../myapp-feature   # 管理情報が残ってlistに幽霊が出る

# OK: 必ず remove で消す
git worktree remove ../myapp-feature

# すでに手で消してしまった場合のお掃除
git worktree prune
```

片付けは必ず `git worktree remove` を使い、もし手で消してしまったら `git worktree prune` で参照を掃除する、と覚えておけば安全です。

### 罠4: Claude Codeに「隣のworktreeを触らせない」

複数worktreeを並べていると、Claude Codeが気を利かせて隣のフォルダ（`../myapp-fix` など）まで読みに行ったり編集しようとすることがあります。これは並列分離の意味を壊します。各worktreeの `CLAUDE.md` に1行入れておきましょう。

```markdown
- このフォルダ外（../ の他のworktree）のファイルは読まない・編集しない
```

---

## まとめ: worktreeでClaude Codeを安全に並列化する5原則

| 原則 | 要点 |
|---|---|
| 1. 作業はworktreeで物理分離 | ブランチ切り替えではなく別フォルダで分ける |
| 2. 1worktree = 1セッション | フォルダごとにClaude Codeを起動する |
| 3. 並列は独立タスクだけ | 同じコードを触るタスクは逐次に回す |
| 4. 役割でフォルダを固定 | feat/fix/exp等に分け、各々に専用CLAUDE.mdを置く |
| 5. 片付けは remove で | 手削除せず remove、残骸は prune |

`git worktree` は機能としては前からありますが、**Claude Codeのような「作業ディレクトリを前提に動くAIエージェント」と組み合わせて初めて真価が出ます**。1つのリポで2つ3つのタスクを安全に並走させられるようになると、「割り込みが来たから中断」という消耗がなくなり、待ち時間も圧縮できます。

まずは「割り込みバグ修正をworktreeで分離する」一手だけでも試してみてください。`git stash` 地獄から抜け出せる感覚が、すぐに体感できるはずです。

---

## 補足: 試すための無料リポジトリ

worktreeでの並列運用を本格的に回すなら、各worktreeに置くCLAUDE.md設計や、コミットの刻み方といった「土台のスキル」が揃っているとスムーズです。私が実戦で使っている4本のスキルを無料リポで公開しています。

**無料スターター（GitHub・CC BY 4.0）:**
https://github.com/noguso245-jpg/claude-code-skills-starter

中身は、Claude Code実戦投入の4本のスキル — **CLAUDE.md設計 / 計画ファースト開発（PIV: Plan-Implement-Verify）/ AIコミット戦略 / アジャイルなプロンプト設計** — が日本語・英語の両方で入っています。クローンしてそのまま自分のプロジェクトにコピーして使えます。

役に立ったら、GitHubで ⭐ Star をいただけると新しい無料スキルを追加する励みになります。

---

最新のTipsはXでも発信しています: [@k___n___t_1125](https://x.com/k___n___t_1125)
