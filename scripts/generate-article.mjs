// queue/ が QUEUE_TARGET 未満のとき、Anthropic API で Qiita 記事を1本生成して queue/ に書き出す。
// 公開は drip-publish.yml が別途行う。このスクリプトは生成のみ。
// 必要env: ANTHROPIC_API_KEY（必須）, GEN_MODEL（任意）, QUEUE_TARGET（任意）

import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.GEN_MODEL || 'claude-sonnet-4-6';
const TARGET = parseInt(process.env.QUEUE_TARGET || '5', 10);
const ROOT = process.cwd();
const QUEUE = join(ROOT, 'queue');
const PUBLIC = join(ROOT, 'public');

if (!API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}
if (!existsSync(QUEUE)) mkdirSync(QUEUE, { recursive: true });

const mdFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : []);
const stripPrefix = (f) => f.replace(/\.md$/, '').replace(/^\d+-/, '');

const queueFiles = mdFiles(QUEUE);
if (queueFiles.length >= TARGET) {
  console.log(`Queue has ${queueFiles.length} article(s) (>= target ${TARGET}). Skip generation.`);
  process.exit(0);
}

const usedSlugs = new Set([...mdFiles(PUBLIC), ...queueFiles].map(stripPrefix));

// 既出と重複しない予備トピック。全て使い切ったら終了（運用者がここに追記）。
const TOPICS = [
  { slug: 'claude-code-debug-only-mode', topic: '診断専用デバッグ — 推測で直さず、原因特定に徹してから直す型。再現条件の確定・仮説と検証・ログの絞り方・「直す前に診断」をClaude Codeにやらせる手順' },
  { slug: 'claude-code-spec-driven', topic: '仕様駆動開発 — 実装前に仕様書（要件・入出力・受け入れ条件）をClaude Codeに固めさせ、それを契約として実装させる。仕様の書かせ方、仕様レビュー、暴走防止' },
  { slug: 'claude-code-code-review', topic: 'Claude Codeにコードレビューをさせる — 観点（バグ/セキュリティ/命名/テスト不足）の指定、重大度付き出力、自分のPR前セルフレビューの型' },
  { slug: 'claude-code-token-optimization', topic: 'トークン最適化 — Claude Codeの利用コストを下げる実務。無駄な全ファイル読み込みを避ける、出力を絞る、サブエージェントへの分散、CLAUDE.mdの軽量化' },
  { slug: 'claude-code-antipatterns', topic: 'Claude Code 失敗パターン集 — 雑な指示・丸投げ・検証なし採用・1セッション詰め込み等のアンチパターンと、それぞれの直し方をBefore/Afterで' },
  { slug: 'claude-code-refactor-safely', topic: '安全なリファクタリング — 振る舞いを変えずに改善する型。テストで固定→小さな単位→意図の説明、巨大リファクタの分割、Claude Codeでの進め方' },
  { slug: 'claude-code-session-scope', topic: 'セッションスコープ設計 — 1セッション1テーマに保つ運用。いつ新セッションを始めるか、引き継ぎの作り方、長時間作業の分割' },
  { slug: 'claude-code-multi-file-edit', topic: '大規模な複数ファイル編集を安全に — 影響範囲の事前把握、段階的変更、整合性チェック、壊さないための検証ループ' },
];

const next = TOPICS.find((t) => !usedSlugs.has(t.slug));
if (!next) {
  console.log('No unused predefined topic left. Add topics to scripts/generate-article.mjs. Skipping.');
  process.exit(0);
}

const FUNNEL = `---

## 補足: 試すための無料リポジトリ

本記事の内容を実際のプロジェクトで試すには、土台となるCLAUDE.mdとフォルダ構成があるとスムーズです。私が使っているスターター構成を無料で公開しています。

**無料スターター（GitHub）:**
https://github.com/noguso245-jpg/claude-code-skills-starter

さらに踏み込んで、ワークフローやサブエージェント設計を「実行可能なスキルファイル」としてまとめたパッケージも用意しています。手元で \`/コマンド\` として呼び出せる形です。

- **スターターパック（¥1,980）:** CLAUDE.mdテンプレ7種・Hooks・MCP設定
  https://streamsolty.gumroad.com/l/gliwz
- **ワークフローOS（¥9,800）:** 79本のスキル + ワークフロー3本 + プロンプト10種
  https://streamsolty.gumroad.com/l/vhcysn

まずは無料リポジトリから試して、もっと体系的に使いたくなったら検討してもらえれば十分です。記事の内容だけでも効果は出ます。

---

最新のTipsはXでも発信しています: [@k___n___t_1125](https://x.com/k___n___t_1125)`;

const PROMPT = `あなたはClaude Codeに詳しい技術記事ライターです。Qiitaに公開する完成記事を1本、日本語で書いてください。

## トピック
${next.topic}

## 読者
毎日Claude Codeを使うエンジニア・個人開発者。「機能は知っているが使いこなせていない」層。

## 構成と品質
- 冒頭に「あるある課題」フックを置く
- 本文は具体例・コードブロック・表・Before/Afterを多用。9割が無料知識で完結する実用記事にする
- 既存記事（CLAUDE.md設計 / Hooks安全設定 / サブエージェント5型 / スラッシュコマンド / コンテキスト軽量化 / Git worktree / Plan Mode / MCP / コミット戦略 / TDD）と内容が重複しないこと

## 厳守事項（重要）
- 価格表記は「¥1,980」（スターターパック）と「¥9,800」（ワークフローOS）のみ。「¥12,800」「$85」「値上げ」は絶対に書かない
- スキル総数は「79本」のみ（53/59/67/77は書かない）
- URLは無料リポ https://github.com/noguso245-jpg/claude-code-skills-starter、Gumroad https://streamsolty.gumroad.com/l/gliwz と https://streamsolty.gumroad.com/l/vhcysn 、X @k___n___t_1125 のみ
- 宣伝は記事末尾の固定ブロックだけ。本文中で商品を繰り返し宣伝しない

## 出力フォーマット（厳守）
次の Qiita フロントマターで始め、本文を書き、最後に指定のファネルブロックを**そのまま**連結する。**Markdownファイルの中身だけを出力**し、前置き・後書き・コードフェンス(\`\`\`)で全体を囲うことは絶対にしない。

フロントマター（tagsは内容に合うものを最大5個）:
---
title: '記事タイトル'
tags:
  - ClaudeCode
  - AI
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

そして本文。最後に必ず次のブロックをそのまま付ける:

${FUNNEL}`;

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content: PROMPT }],
  }),
});

if (!res.ok) {
  console.error(`Anthropic API error: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const data = await res.json();
let md = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

// 念のため全体を囲うコードフェンスを除去
if (md.startsWith('```')) md = md.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```\s*$/, '').trim();

// 簡易検証: フロントマターとファネルがあるか、禁止表記が無いか
const bad = /¥12,?800|\$85|値上げ|53スキル|59スキル|67スキル|77スキル/;
if (!md.startsWith('---') || !md.includes('gumroad.com/l/vhcysn') || bad.test(md)) {
  console.error('Generated article failed validation (frontmatter/funnel/forbidden tokens). Aborting without writing.');
  process.exit(1);
}

// 連番プレフィックスの次番号を決める
const nums = queueFiles.map((f) => parseInt((f.match(/^(\d+)-/) || [])[1] || '0', 10));
const nextNum = String((nums.length ? Math.max(...nums) : 2) + 1).padStart(2, '0');
const outName = `${nextNum}-${next.slug}.md`;
writeFileSync(join(QUEUE, outName), md, 'utf8');
console.log(`Generated queue/${outName} (model=${MODEL}). Queue now ${queueFiles.length + 1}.`);
