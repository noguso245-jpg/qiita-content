---
title: ターミナルだけじゃもったいない：Claude Code を VS Code / JetBrains と統合して使い倒す
tags:
  - JetBrains
  - VSCode
  - 開発効率化
  - 生成AI
  - ClaudeCode
private: false
updated_at: '2026-06-28T16:08:46+09:00'
id: 31e9a319df89382734f0
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

## こんな使い方、していませんか？

毎日 Claude Code を使っているのに、

- 差分を確認するために、ターミナルの色付きテキストを目で追っている
- 「このファイルのこの行を直して」と、ファイルパスと行番号を手で打ち込んでいる
- lint や型エラーが出ているのに、Claude にそれをコピペで貼って伝えている
- 編集中のファイルやエディタの選択範囲を、わざわざ説明し直している

これらは、Claude Code をエディタ（IDE）と統合すると、ほぼ全部いらなくなります。差分はエディタのネイティブ diff ビューアに開き、選択範囲は自動でコンテキストに乗り、lint・型エラーも自動で共有されます。

本記事は「ターミナルでは使えているが、IDE 統合の旨味を活かせていない」人向けに、VS Code と JetBrains の統合を**公式ドキュメント準拠**でまとめます。メニュー名・設定キー・ショートカットは公式に基づいています。

---

## まず結論：統合で何が変わるか（Before / After）

| 作業 | Before（素のターミナル） | After（IDE 統合あり） |
| --- | --- | --- |
| 差分の確認 | ターミナルに色付きテキストで表示 | エディタのネイティブ diff ビューアに side-by-side 表示。差分上で直接編集も可 |
| 行の指定 | `src/auth.ts の 5〜10 行目を…` と手打ち | コードを選択 → ショートカット一発で `@app.ts#5-10` を挿入 |
| 編集中ファイルの共有 | 「いま開いてるのは〜」と説明 | アクティブファイルのパスと選択範囲が自動でプロンプトに付く |
| lint / 型エラー | エラーをコピペして貼る | IDE の診断（Problems）が自動で Claude に共有される |

ここが IDE 統合の核心です。順に見ていきます。

---

## VS Code（および Cursor / フォーク）での導入

### 前提

- VS Code 1.98.0 以上
- Anthropic アカウント（初回起動時にサインイン）

VS Code 拡張は CLI も同梱しており、統合ターミナルから `claude` も使えます。

### インストール

VS Code で `Ctrl+Shift+X`（Mac は `Cmd+Shift+X`）で拡張機能ビューを開き、「Claude Code」で検索して **Install**。

Cursor や Devin Desktop、Kiro などの VS Code フォークでも同じく拡張機能ビューから入ります。入らない環境では [Open VSX レジストリ](https://open-vsx.org/extension/Anthropic/claude-code) からも導入できます。それも無理なら、統合ターミナルで `claude` を直接実行すれば CLI として動きます。

> インストール後に拡張が出てこないときは、VS Code を再起動するか、コマンドパレットから **Developer: Reload Window** を実行します。

### パネルを開く

VS Code 全体で Claude Code を表す目印は **Spark アイコン**です。開き方は複数あります。

- **Editor Toolbar**（エディタ右上）の Spark アイコン。※ファイルを開いているときだけ表示されます
- **Activity Bar**（左サイドバー）の Spark アイコン → セッション一覧が出る（常時表示）
- **Command Palette**（`Ctrl+Shift+P`）で "Claude Code" と入力して "Open in New Tab" などを選択
- **Status Bar**（右下）の **✱ Claude Code**。※ファイル未オープンでも使える

初回はサインイン画面が出るので **Sign in** からブラウザで認可します。

### IDE 統合の中身を体感する 4 つの機能

**1. 差分プレビュー（side-by-side）**

Claude がファイルを編集しようとすると、元の内容と変更案を並べた diff を表示して許可を求めます。ここで **diff ビュー上で直接編集してから承認** することもでき、その場合「ユーザーが手を入れた」ことが Claude に伝わるため、Claude は自分の提案どおりにファイルがある、と思い込みません。地味ですが事故防止に効きます。

**2. 選択範囲の受け渡し**

エディタでテキストを選択すると、その内容は自動で Claude から見えます（プロンプト下部に選択行数が出る）。さらに `Alt+K`（Mac は `Option+K`）で `@app.ts#5-10` のような **ファイルパス＋行番号の @-mention** をプロンプトに挿入できます。

選択を Claude に見せたくないときは、選択インジケータをクリックしてトグル（eye-slash アイコン＝非表示）にできます。

**3. @-mention でのファイル参照**

`@` に続けてファイル名を打つとファジーマッチで候補が出ます。フォルダはトレイリングスラッシュ付きで指定します。

```text
> @auth のロジックを説明して（auth.js / AuthService.ts などに曖昧一致）
> @src/components/ には何がある？（末尾スラッシュでフォルダ指定）
```

**4. 診断（lint / 型エラー）の連携**

拡張が有効なとき、CLI 側からは `mcp__ide__getDiagnostics` というツールで、**VS Code の Problems パネルの診断（エラー・警告）** を取得できます。これにより「型エラーが出ているはずだから直して」を、エラー文を貼らずに頼めます。

### Plan モードはエディタで効く

プロンプトボックス下のモード表示をクリックすると、permission mode を切り替えられます。**Plan モード**では Claude がやることを説明し、承認まで変更しません。VS Code ではこのとき **プランがフルの markdown ドキュメントとして開き、インラインでコメントを書いて修正指示を返せます**。デフォルトは設定 `claudeCode.initialPermissionMode` で変えられます（`default` / `plan` / `acceptEdits` / `bypassPermissions`）。

### 覚えておくと速いショートカット（VS Code）

| 操作 | ショートカット（Win/Linux → Mac） |
| --- | --- |
| エディタ ⇄ Claude のフォーカス切替 | `Ctrl+Esc` → `Cmd+Esc` |
| 新規タブで会話を開く | `Ctrl+Shift+Esc` → `Cmd+Shift+Esc` |
| @-mention 参照を挿入（要エディタフォーカス） | `Alt+K` → `Option+K` |
| 閉じたセッションを再オープン | `Ctrl+Shift+T` → `Cmd+Shift+T` |
| 改行（送信せず） | `Shift+Enter` |

※ `Ctrl+N`（新規会話）は `enableNewConversationShortcut` を `true` にしたときのみ有効です。

### 主な拡張設定（Extensions → Claude Code）

| 設定キー | 既定 | 説明 |
| --- | --- | --- |
| `useTerminal` | `false` | グラフィカルパネルではなく CLI（ターミナル）モードで起動 |
| `initialPermissionMode` | `default` | 新規会話の許可モード |
| `preferredLocation` | `panel` | Claude を開く場所（`sidebar` / `panel`） |
| `autosave` | `true` | Claude が読み書きする前にファイルを自動保存 |
| `respectGitIgnore` | `true` | `.gitignore` のパターンをファイル検索から除外 |
| `useCtrlEnterToSend` | `false` | Enter ではなく Ctrl/Cmd+Enter で送信 |

> Tip: `settings.json` に `"$schema": "https://json.schemastore.org/claude-code-settings.json"` を足すと、設定の補完とバリデーションが効きます。

---

## JetBrains（IntelliJ / PyCharm など）での導入

### 対応 IDE

公式に挙がっているのは IntelliJ IDEA / PyCharm / Android Studio / WebStorm / PhpStorm / GoLand など、ほとんどの JetBrains IDE です。

### インストール

JetBrains マーケットプレイスから **Claude Code プラグイン** を入れて、IDE を再起動します。反映されないときは、もう一度（場合によっては複数回）完全に再起動してください。

### 起動と接続

- **IDE 内ターミナルから**：統合ターミナルで `claude` を実行すると、統合機能がすべて有効になります
- **外部ターミナルから**：`claude` を起動し、`/ide` コマンドを実行して JetBrains IDE に接続します

IDE のプロジェクトルートと同じディレクトリで Claude Code を起動すると、IDE と同じファイル群にアクセスできます。

### JetBrains 側の統合機能

- **クイック起動**：`Ctrl+Esc`（Mac は `Cmd+Esc`）でエディタから Claude Code を開く
- **差分表示**：変更をターミナルではなく **IDE の diff ビューア**に表示
- **選択コンテキスト**：現在の選択範囲やタブが自動で Claude Code に共有される
- **ファイル参照ショートカット**：`Alt+Ctrl+K`（Mac は `Cmd+Option+K`）で `@src/auth.ts#L1-99` のような参照を挿入
- **診断共有**：IDE の lint・構文エラーなどの診断が、作業しながら自動で Claude に共有される

### 設定

差分の表示先は Claude Code 側の設定で切り替えます。

1. `claude` を起動
2. `/config` を実行
3. diff tool を `auto`（IDE に表示）か `terminal`（ターミナルのまま）に設定

プラグイン設定は **Settings → Tools → Claude Code [Beta]** にあります。`claude` の起動コマンド（例：`claude` / `/usr/local/bin/claude` / `npx @anthropic-ai/claude-code`）や、自動更新の有効化などを設定できます。

### JetBrains で最初にハマる：ESC キーが効かない

JetBrains のターミナルでは `ESC` が Claude Code の処理中断に効かないことがあります。これは ESC がエディタへのフォーカス移動に割り当たっているためです。

1. **Settings → Tools → Terminal** を開く
2. 「Move focus to the editor with Escape」のチェックを外す、または「Configure terminal keybindings」から「Switch focus to Editor」のショートカットを削除
3. 適用する

これで ESC が中断として機能します。

---

## ターミナル版との使い分け

IDE 統合は便利ですが、**CLI にしかない機能**もあります。CLI 専用機能が必要なときは、VS Code の統合ターミナルで `claude` を走らせれば、diff 表示や診断共有といった統合機能はそのまま効きます。

公式に挙がっている主な差分は次のとおりです。

| 機能 | CLI | VS Code 拡張（パネル） |
| --- | --- | --- |
| コマンド・スキル | すべて | サブセット（`/` で確認） |
| `!` の bash ショートカット | あり | なし |
| Tab 補完 | あり | なし |
| Checkpoints（巻き戻し） | あり | あり |

**使い分けの目安：**

- 普段の実装・差分レビュー・選択範囲の受け渡しが多い → **IDE 拡張のパネル**が快適
- `!` bash ショートカットや Tab 補完、パネルにない `/` コマンドを多用する → **CLI**（統合ターミナルで `claude`）
- 拡張とのつなぎ：拡張と CLI は会話履歴を共有します。拡張の会話を CLI で続けるなら、ターミナルで `claude --resume` を実行すると会話を選んで再開できます。

外部ターミナルを使うなら、Claude Code 内で `/ide` を実行して VS Code / JetBrains に接続します。

---

## IDE ならではの効率化テク

- **ターミナル出力をプロンプトに引き込む**：VS Code では `@terminal:name`（name はターミナルのタイトル）で、コマンド出力やエラーログをコピペせずに Claude へ渡せます。
- **選択を見せる／隠すをトグル**：機密ファイルは選択インジケータの eye-slash で隠せます。恒久的に除外したいファイル（例：`.env`）は、そのパスに対する `Read` の **deny ルール**を設定します。deny にすると、選択テキストもアクティブファイル通知も Claude に届きません。
- **複数会話を並行**：Command Palette の **Open in New Tab** / **Open in New Window** でタスクごとに会話を分離できます。タブの Spark アイコンの色付きドットは状態表示（青＝許可待ち、オレンジ＝非表示中に完了）。
- **巻き戻し（Checkpoints）**：メッセージにホバーすると rewind ボタンが出て、「会話だけ分岐」「コードだけ巻き戻し」「両方」を選べます。

---

## よくあるつまずきと対処

**VS Code：Spark アイコンが見えない**

- ファイルを開いているか（フォルダだけでは Editor Toolbar に出ない）
- VS Code 1.98.0 以上か（Help → About）
- **Developer: Reload Window** で再起動
- 他の AI 拡張（Cline / Continue など）を一時的に無効化
- Restricted Mode では動かない（ワークスペースの信頼を確認）
- それでも出なければ右下の Status Bar の **✱ Claude Code** から開く

**macOS で `Cmd+Esc` が効かない**

macOS Tahoe 以降は、システムの Game Overlay が `Cmd+Esc` を先取りすることがあります。System Settings → Keyboard → Keyboard Shortcuts → Game Controllers で Game Overlay のチェックを外すか、VS Code のキーバインド（`Cmd+K Cmd+S`）で `Claude Code: Focus input` を別キーに割り当てます。

**JetBrains：「No available IDEs detected」**

- プラグインが有効か、IDE を完全に再起動したか
- 統合ターミナルから `claude` を実行しているか
- WSL2 では NAT ネットワークや Windows Firewall がブロックしている場合がある（公式は Firewall ルール追加か mirrored networking への切替を案内）

**JetBrains：Claude アイコンで「command not found」**

`claude --version` で導入を確認し、プラグイン設定で Claude コマンドのパスを指定します。WSL なら `wsl -d Ubuntu -- bash -lic "claude"` 形式をコマンドに設定します（`Ubuntu` はディストリビューション名）。

**Remote Development を使うとき**

JetBrains の Remote Development では、プラグインは**リモートホスト側**に **Settings → Plugin (Host)** から入れる必要があります。ローカルクライアントに入れても効きません。

---

## セキュリティ上の注意（auto-edit を使うなら）

auto-edit を有効にすると、Claude は `settings.json` や `tasks.json` のように **IDE が自動実行しうる設定ファイル**を書き換えられます。信頼できないコードを扱うときは、VS Code の Restricted Mode を使う、auto-accept ではなく手動承認にする、変更を必ず確認してから承認する、といった対策が推奨されています。

なお拡張が動いているとき、CLI は `ide` という名前のローカル MCP サーバーに接続して diff 表示・選択取得を実現しています。`127.0.0.1` のランダムな高位ポートにバインドされ、起動ごとに生成される認証トークンが必要で、外部マシンからは到達できません。

---

## まとめ

IDE 統合の本質は、**「説明していたこと（差分・行・編集中ファイル・エラー）を自動でやり取りする」**ことです。

- 差分は IDE の diff ビューアに開き、その場で直して承認できる
- 選択範囲は自動で渡り、`Alt+K`（JetBrains は `Alt+Ctrl+K`）で行番号付き参照を挿入
- lint / 型エラーは自動共有
- CLI 専用機能が要るときだけ統合ターミナルで `claude`

まだターミナルだけなら、まずは拡張／プラグインを入れて、差分プレビューと選択受け渡しの 2 つを今日から使ってみてください。手打ちの説明が一気に消えます。

---

## 無料リポで関連スキルも配布中（CC BY 4.0）

本記事で紹介した手順はそのままコピペして使えます。あわせて無料リポ **claude-code-skills-starter** では、実用スキル4本（claude-md-architecture / piv-development-loop / ai-commit-strategy / agile-prompt-template）＋ CLAUDE.md テンプレート＋ pre-commit hook を配布しています。

1. リポを開く → https://github.com/noguso245-jpg/claude-code-skills-starter
2. `skills/ja/` の該当スキル .md をコピーして自分のプロジェクトで使う
3. 役立ったら ⭐ Star を（同じように探している人に見つけてもらいやすくなります。更新を追うなら Watch）
