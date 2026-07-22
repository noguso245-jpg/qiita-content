---
title: Reactで動画を量産する — Remotionで「音に反応する」アニメーション動画を作る実装パターン（横・縦両対応）
tags:
  - React
  - remotion
  - TypeScript
  - 動画
  - 個人開発
private: false
updated_at: '2026-07-22T15:02:59+09:00'
id: aaa3f60782d2f1cf8b39
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---

動画コンテンツを作っていると、こんな引っかかりが出てきます。

- 「色だけ違う動画」を10本作るのに、編集ソフトのタイムラインを10回触りたくない
- 横動画（16:9）とShorts用の縦動画（9:16）を両方出すのに、レイアウトを2回作り直すのは二度手間
- BGMに合わせて図形が動く演出を、キーフレーム手打ちで作るのは現実的でない

私はこの3つを、**Remotion**（Reactで動画を書くフレームワーク）で解決しました。この記事では、自分のプロジェクトで実際に使っている実装を簡略化して解説します。

**この記事で分かること**

- テンプレ×パラメータ差し替えで動画を量産する基本構成
- `useAudioData` / `visualizeAudio` で音に反応するアニメーションを作るパターン
- Compositionを2つ登録して、1つのコンポーネントを横・縦両対応にする設計

Remotionの仕様に関する記述は**執筆時点**（Remotion 4.0系）のものです。実装の際は[公式ドキュメント](https://www.remotion.dev/docs/)で最新仕様を確認してください。

---

## Remotionとは — 「Reactコンポーネント = 動画」

Remotionは、Reactコンポーネントとして動画を記述し、レンダリングしてMP4を出力するフレームワークです。考え方は「動画=フレームの連続」「各フレームの見た目=フレーム番号を入力とするReactコンポーネント」。`useCurrentFrame()` で現在のフレーム番号が取れるので、CSSの `transform` や色をフレーム番号の関数として書けば、そのままアニメーションになります。

```tsx
import {useCurrentFrame, useVideoConfig} from 'remotion';

export const Pulse: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps; // 経過秒数

  // 1.4秒周期でゆっくり脈動する
  const scale = 1 + Math.sin(t * Math.PI * 2 * 0.7) * 0.1;

  return <div style={{transform: `scale(${scale})`}}>●</div>;
};
```

重要なのは、**テロップ・図形・動きのすべてをpropsで制御できる**ことです。色パレット・図形の個数・動きの速さを「テーマ」としてpropsに切り出せば、**テーマを差し替えるだけで別の動画**になります。これが「テンプレ×データ差し替え」の量産に向く理由です。

```tsx
// この値を変えるだけで別の動画になる
export type Theme = {
  backgroundColor: string;
  palette: string[];       // 図形に使う色
  circleCount: number;     // 図形の個数
  bounceSpeed: number;     // 揺れの速さ
  audioReactivity: number; // 音への反応の強さ
};
```

---

## 横（16:9）と縦（9:16）を1つのコンポーネントで両対応にする

Remotionでは `<Composition>` 1つが「書き出せる動画1本」に対応します。ポイントは、**同じコンポーネントを解像度違いで2つ登録する**ことです。

```tsx
// Root.tsx
import {Composition} from 'remotion';
import {MyScene} from './compositions/MyScene';

const FPS = 30;
const DURATION_IN_FRAMES = FPS * 30; // 30秒

export const RemotionRoot: React.FC = () => (
  <>
    {/* 横長 16:9（YouTube通常） */}
    <Composition
      id="Scene-Landscape"
      component={MyScene}
      durationInFrames={DURATION_IN_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{theme: myTheme}}
    />
    {/* 縦長 9:16（Shorts） */}
    <Composition
      id="Scene-Vertical"
      component={MyScene}
      durationInFrames={DURATION_IN_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{theme: myTheme}}
    />
  </>
);
```

これだけだと縦動画でレイアウトが崩れるので、コンポーネント側は**絶対座標を書かず、`useVideoConfig()` から取った幅・高さの比率ベース**でレイアウトを組みます。

```tsx
const {width, height} = useVideoConfig();

// 縦横比から列数・行数を自動決定（横長→横並び、縦長→縦に積む）
const aspect = width / height;
const cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
const rows = Math.ceil(count / cols);

// サイズは「画面の短い辺」を基準にする（横でも縦でも見た目の比率が揃う）
const shortSide = Math.min(width, height);
const baseDiameter = shortSide * theme.baseRadiusRatio * 2;
```

グリッドを縦横比から計算し、サイズを短い辺の割合で決める。この2点を守ると、レイアウトコードを一切分岐させずに横・縦両対応になります。

---

## 音に反応させる — useAudioData と visualizeAudio

ここが本題です。`@remotion/media-utils` を使うと、音声ファイルの波形を解析して「現在フレームの音量スペクトル」を取り出せます。

```bash
npm i @remotion/media-utils
```

実装パターンは次のとおりです。

```tsx
import {useAudioData, visualizeAudio} from '@remotion/media-utils';
import {Audio, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

const NUM_SAMPLES = 16; // 執筆時点では2のべき乗である必要がある

export const SceneWithMusic: React.FC<{theme: Theme}> = ({theme}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // public/ 配下の音声を参照し、波形データを取得する
  const src = staticFile('music/bgm.mp3');
  const audioData = useAudioData(src);

  if (!audioData) {
    // 解析が終わるまでは null が返る。完了後に自動で再描画される
    return null;
  }

  // 現在フレームの周波数帯ごとの音量(0..1)。配列の左=低音、右=高音
  const bands = visualizeAudio({fps, frame, audioData, numberOfSamples: NUM_SAMPLES});

  // 低音域の平均から全体の音量 energy を作る
  // ×3 してメリハリを出し、Math.min で1に頭打ちさせる
  const lows = bands.slice(0, 4);
  const energy = Math.min(1, (lows.reduce((a, b) => a + b, 0) / lows.length) * 3);

  return (
    <>
      {/* <Audio> を置くと、曲そのものが出力MP4に含まれる */}
      <Audio src={src} />
      <Stage theme={theme} energy={energy} bands={bands} />
    </>
  );
};
```

ポイントは4つです。

1. **`useAudioData` は解析完了まで `null` を返す**ので必ずガードを入れる
2. **`numberOfSamples` は執筆時点で2のべき乗**（16, 32, 64…）を指定する。戻り値は左が低音・右が高音の配列
3. **ビートに反応させたいなら低音域を使う**。全帯域平均だと反応がぼやけるので、低音側だけ平均して係数を掛け `Math.min(1, x)` で正規化すると「ドン」に合わせてキビキビ動く
4. **`<Audio src={src} />` を忘れない**。`useAudioData` は解析だけで音は出ない。MP4に曲を含めるには `<Audio>` が必要

### energy を見た目に反映する

取り出した `energy` と `bands` を、図形のスケール・跳ね・発光に割り当てます。

```tsx
// 各図形に「担当の周波数帯」を割り当てる → 帯域ごとに違うタイミングで動く
const band = bands[i % bands.length];

// 音量で大きさが変わる
const scale = 1 + (energy * 0.25 + band * 0.35) * theme.audioReactivity;

// 音量で上に跳ねる
const reactBounce = -band * theme.audioReactivity * (cellH * 0.18);

// 音量で発光（box-shadowのぼかし半径と透明度）が強まる
const glow = (energy * 0.5 + band * 0.9) * theme.glowStrength;
```

図形ごとに別の帯域を割り当てると、全部が同時に動くのではなく音の成分に応じてバラバラに反応するので、それらしい演出になります。

### 音源が無くても動くフォールバック

私は `Math.sin` を重ねた擬似的な energy / bands を作るコンポーネントも用意し、音源ファイルの有無で切り替えています。描画部分を「energyとbandsを受け取るだけ」の設計にしておくと、音の出どころが本物でも擬似でも同じコードで済み、曲がまだ無い段階でも動画が完成します。

---

## 素材（BGM・効果音）はライセンスに注意する

BGM・効果音は**利用許諾（商用利用・動画への同梱・投稿可否）を確認した音源だけ**をassetsに配置し、`staticFile()` で参照します。フリー素材でも「クレジット表記必須」「再配布不可」等の条件があるため、配布元の規約は必ず読んでください。コードは量産できても、素材の権利は量産できません。

---

## CLIでレンダリングして量産する

プレビューは `npx remotion studio`、書き出しはCLIで行います。

```bash
# 横・縦をそれぞれ書き出す
npx remotion render src/index.ts Scene-Landscape out/landscape.mp4
npx remotion render src/index.ts Scene-Vertical out/vertical.mp4
```

Composition IDを変えるだけで同じソースから横・縦の2本が出ます。さらに `--props` でpropsをJSONとして外から注入できるので、**テーマを差し替えながらCLIを回すだけで色違い・動き違いの動画を機械的に量産**できます。npm scriptsにまとめておけば一発で全パターンの書き出しまで自動化できます。

---

## まとめ

- Remotionは「Reactコンポーネント=動画」。見た目をpropsに切り出せば**テーマ差し替えで量産**できる
- 音反応は `useAudioData`（完了まで`null`）→ `visualizeAudio` → **低音域からenergyを合成**して図形のscale/跳ね/発光へ。`<Audio>` の配置も忘れずに
- 横・縦両対応は **Compositionを2つ登録＋レイアウトは比率ベース**（グリッドはアスペクト比、サイズは短い辺基準）で分岐なしに実現できる
- 素材はライセンス確認済みのものだけを使い、書き出しは `npx remotion render` でCLI量産する

タイムラインを触る編集から、パラメータを触る編集へ。Reactが書けるなら動画制作のかなりの部分をコード化できます。仕様の記述は執筆時点のものなので、実装時は[公式ドキュメント](https://www.remotion.dev/docs/)を併せて確認してください。
