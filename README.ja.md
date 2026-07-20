<div align="center">
  <img src="apps/landing/public/favicon.png" alt="ReadAware" width="72" height="72" />
  <h1>ReadAware</h1>
  <p><strong>Reading that remembers.</strong></p>
  <p>
    ピクセル単位まで磨き上げたモダンなリーダー。あなたの本、注釈、
    そして何度も立ち返る考えを理解するエージェントを内蔵しています。
  </p>
  <p>
    <a href="https://readaware.app">公式サイト</a> ·
    <a href="https://github.com/ahpxex/read-aware/releases/latest">ダウンロード</a> ·
    <a href="https://discord.gg/whDrKXwHWU">Discord</a>
  </p>
  <p>
    <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · 日本語
  </p>
</div>

![ReadAware の多言語ライブラリ](apps/landing/public/screenshots/shelf.webp)

## 美しく読む。深く覚える。

ReadAware は macOS、Windows、Linux、Android、iOS で使える無料のオープン
ソースリーダーです。丹念に作り込んだ読書体験と内蔵エージェントを組み合わせ
ています。エージェントはツールを使い、文脈に沿って質問に答え、あなたが大切
にする本・一節・メモ・会話から育ちつづける記憶を築きます。

- **文とともに。** 一文ずつ読むスタイルが、ページを静かで集中しやすく、
  ADHD フレンドリーに保ちます。
- **自分のやり方でマークする。** 読書の流れを断ち切らずに、下線・ハイライト・
  メモが書けます。
- **ページから聞く。** わからない一節を AI と話す、気になる考えを掘り下げる、
  単語を調べる——どれも本から離れずにできます。
- **言葉をあとのために。** 読みながら語彙に注釈をつけて、一度きりの検索では
  なく復習できる素材にします。
- **ページを自分のものに。** 言語、カラーテーマ、フォント、文字サイズ、行間
  などの読書設定を切り替えられます。
- **習慣が育つのが見える。** 読書時間の統計で、本やセッションをまたいだ進捗
  が見えます。
- **ほとんどの本を持ち込める。** EPUB、MOBI、AZW3、FB2、PDF が形式変換なしで、
  共通の閲覧・選択・注釈・進捗モデルを共有します。

<table>
  <tr>
    <td width="50%"><img src="apps/landing/public/screenshots/reader.webp" alt="ReadAware の一文ずつ読むリーダー" /></td>
    <td width="50%"><img src="apps/landing/public/screenshots/context.webp" alt="ReadAware の文脈を理解するアシスタント" /></td>
  </tr>
</table>

## なぜ違って感じられるのか

インターフェースはピクセル単位まで調整されています。その結果は、意図された
静けさと一貫性であり、AI っぽさのなさです。

AI は読書体験を乗っ取るのではなく、そのそばに控えます。エージェントはコンテ
キストの取得、ツールの呼び出し、記憶の更新を行いますが、ページはあくまで
ページのまま。タイポグラフィが第一、コントロールは役立つときだけ、そして
長い読書セッションに応えるディテール。

## プラットフォーム

| プラットフォーム | 状態 |
| --- | --- |
| macOS | 利用可能 |
| Android | 利用可能 |
| Windows | 利用可能。実環境でのテスト歓迎 |
| Linux | 利用可能。実環境でのテスト歓迎 |
| iOS | 対応済み。App Store での配布は未提供 |

デバイス間同期は計画中です。現在の ReadAware はローカルファースト：本、読書
進捗、注釈、会話、記憶はデバイスに残り、リモートのモデル推論はオプションで、
プロバイダーは自分で選べます。

## 仕組み

ReadAware は 1 つのエージェントが検索、コンテキストの組み立て、ツール使用、
記憶の更新をオーケストレーションします。チャット履歴は記憶システムそのもの
ではなく素材であり、永続的なコンテキストは本をまたいだ読者の足跡から構築
されます。

```text
ReadAware アプリ
├── React インターフェース       本棚、リーダー、注釈、チャット、設定
├── ローカルエージェント         ツール、検索、コンテキスト、記憶更新
├── SQLite                       プロダクトデータ、イベントログ、FTS、プロジェクション
└── ネイティブファイルシステム   取り込んだ本と大きな blob

リモートサービス
├── モデルプロバイダー           オプション。読者自身のアカウントで推論
└── 同期リレー                   計画中。暗号化されたイベントと blob の転送
```

信頼できる唯一の情報源はローカルにあります。生のドメインイベントが同期可能な
記録となり、記憶や検索の状態は再構築可能なプロジェクションです。検索には
ベクターデータベースではなく、SQLite FTS にスコープ・新しさ・重要度のシグナル
を組み合わせて使います。

## リポジトリ

ReadAware は Turborepo でオーケストレーションされた Bun workspace のモノレポ
です。

| パス | 責務 |
| --- | --- |
| `apps/web` | React 19 インターフェース、TanStack Router、Jotai、Tailwind CSS v4 |
| `apps/desktop` | Tauri 2 シェルとネイティブなストレージ / プラットフォームコマンド |
| `apps/landing` | 公式サイトとリリースダウンロード |
| `packages/agent` | エージェントランタイム、モデルアダプター、検索と記憶のパイプライン |
| `packages/core` | ドメインエンティティ、イベント、ストレージ契約 |
| `packages/ui` | 共有デザインシステムと同居する Storybook ストーリー |

アーキテクチャの決定と目標データ契約は
[`docs/agent-architecture.md`](docs/agent-architecture.md) と
[`docs/data-model.md`](docs/data-model.md) にあります。

## ローカルで動かす

前提条件：[Bun](https://bun.sh/)、Rust ツールチェーン、そして Tauri がお使い
のプラットフォームで必要とするネイティブ依存。

```bash
bun install
bun run dev
```

よく使うコマンド：

| コマンド | 用途 |
| --- | --- |
| `bun run dev` | Tauri アプリを開発モードで起動 |
| `bun run dev:web` | UI シェルのみを Vite で起動 |
| `bun run storybook` | デザインシステムと機能ストーリーを閲覧 |
| `bun run typecheck` | 全ワークスペースの型チェック |
| `bun run build` | アプリのフロントエンドをビルドし型チェック |
| `bun run build:desktop` | ネイティブデスクトップのリリースバンドルを生成 |
| `bun run build:landing` | 公式サイトをビルド |

プロダクトの挙動は Tauri 上で検証する必要があります。通常のブラウザには、
リリース版アプリが使うネイティブ IPC、SQLite、ファイルシステム、book blob、
本番 CSP のパスがありません。

## リリース

バージョンタグを打つと `.github/workflows/release.yml` が macOS、Windows、
Linux、Android のアーティファクトをビルドします。最新のダウンロードと
インストールファイルは
[latest release](https://github.com/ahpxex/read-aware/releases/latest) を
参照してください。

## コミュニティ

質問、アイデア、バグ報告、読書の話——どれも
[ReadAware Discord](https://discord.gg/whDrKXwHWU) へどうぞ。

## ライセンス

ReadAware は [MIT License](LICENSE) の下で無料かつオープンソースです。
