import { Link, createFileRoute } from "@tanstack/react-router";
import { REPO_URL } from "../../../lib/releases";
import { DISCORD_URL } from "../../../lib/site";

export const Route = createFileRoute("/ja/docs/")({
  head: () => ({
    meta: [
      { title: "ドキュメント — ReadAware" },
      {
        name: "description",
        content:
          "ReadAwareのインストール、読書のはじめ方、プラグインによるアプリの拡張について。",
      },
    ],
  }),
  component: DocsOverview,
});

function DocsOverview() {
  return (
    <article className="doc-prose">
      <h1>ドキュメント</h1>
      <p className="lead">
        ReadAwareはAIネイティブな読書アプリです。EPUB、MOBI、AZW3、FB2、PDFを1つのリーダーで読み、本・ハイライト・会話をまたいでメモリを育てていきます。無料でローカルファースト、AIはお手持ちのAPIキーで動きます。
      </p>

      <h2>まずはここから</h2>
      <ul>
        <li>
          <Link to="/ja/docs/install">ダウンロードとインストール</Link> —
          macOS、Windows、Linux、Android向けのインストーラーと、OSが未署名アプリを警告したときの対処法。
        </li>
        <li>
          <Link to="/ja/docs/getting-started">使いはじめる</Link> —本のインポート、読書と注釈、AIプロバイダーの接続、そしてデータの保存場所について。
        </li>
      </ul>

      <h2>アプリを拡張する</h2>
      <ul>
        <li>
          <Link to="/ja/docs/plugins">プラグインシステム</Link> —プラグインにできることと、信頼モデルの仕組み。
        </li>
        <li>
          <Link to="/ja/docs/plugins/api">APIリファレンス</Link> —マニフェスト、ライフサイクル、権限、コントリビューション、ビューまで、プラグイン作成の契約のすべて。
        </li>
        <li>
          <Link to="/ja/docs/plugins/publishing">公開する</Link> —作ったプラグインをアプリ内マーケットプレイスに載せる方法。
        </li>
      </ul>

      <h2>そのほか</h2>
      <p>
        アプリは
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        でオープンに開発されています。質問やバグ報告、作ったものの共有には、
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Discord
        </a>
        に参加するか、issueを立ててください。
      </p>
    </article>
  );
}
