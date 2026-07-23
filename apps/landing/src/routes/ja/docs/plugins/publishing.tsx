import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/ja/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "公開する — ReadAware ドキュメント" },
      {
        name: "description",
        content:
          "ReadAwareマーケットプレイスへのプラグインの提出方法。リポジトリの構成、検証、レビューで求められること。",
      },
    ],
  }),
  component: PublishingPage,
});

function PublishingPage() {
  return (
    <article className="doc-prose">
      <h1>プラグインを公開する</h1>
      <p className="lead">
        マーケットプレイスはRaycastの拡張リポジトリと同じ方式で動きます。プラグインは公開リポジトリ
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins
        </a>
        に置かれ、プルリクエスト経由で取り込まれます。マージされると、アプリの「設定
        → プラグイン →
        マーケットプレイス」に現れ、ワンクリックでインストールできるようになります。
      </p>

      <h2>TypeScriptで書く</h2>
      <p>
        TypeScriptが推奨ルートです。リポジトリには、型付きAPI（
        <code>types/plugin-api.d.ts</code>）が設定済みの<code>template/</code>
        が含まれています。これをコピーして<code>src/main.ts</code>
        を書き、自己完結した単一のモジュールをビルドします。
      </p>
      <pre>
        <code>bun build src/main.ts --outfile main.js --format esm</code>
      </pre>
      <p>
        配布されるのは常にビルド済みの<code>main.js</code>
        です。レビュアーが本当のコードを読めるように、<code>src/</code>
        もコミットしたままにしてください。素のJavaScriptでもまったく問題ありません。
        <code>plugins/</code>
        にある公式プラグインはこの方式で書かれています。生きた実例として活用してください。
      </p>

      <h2>提出する</h2>
      <ol>
        <li>リポジトリをフォークします。</li>
        <li>
          <code>template/</code>を
          <code>plugins/&lt;your-plugin-id&gt;/</code>
          にコピーします。少なくとも<code>manifest.json</code>と
          <code>main.js</code>
          を含めてください。フォルダ名はマニフェストの<code>id</code>
          と一致している必要があります。
        </li>
        <li>
          <code>registry.json</code>
          に対応するエントリーを追加します。配列はidでソートされた状態を保ってください。
        </li>
        <li>
          CIが実行するのと同じチェックを走らせます。
          <pre>
            <code>{`node scripts/validate.mjs
npx tsc --noEmit`}</code>
          </pre>
        </li>
        <li>
          プラグインが何をするのか、宣言した各権限がなぜ必要なのかを説明するプルリクエストを開きます。
        </li>
      </ol>
      <p>
        CIはレジストリとマニフェストの整合性、idの形式、権限のホワイトリスト、ファイルの存在を検査し、すべてのTypeScriptプラグインを型チェックします。
      </p>

      <h2>更新</h2>
      <p>
        手順は同じです。1つのプルリクエストで<code>manifest.json</code>と
        <code>registry.json</code>の両方の<code>version</code>
        を上げてください。なお、アプリはレジストリをCDN経由で読むため、マージされた更新がマーケットプレイスのタブに現れるまで少し時間がかかることがあります。
      </p>

      <h2>レビューで求められること</h2>
      <ul>
        <li>
          権限は最小限だけを宣言してください。コードが使う以上の権限を求めるプルリクエストは差し戻されます。
          <Link to="/ja/docs/plugins/api">権限の表</Link>を参照してください。
        </li>
        <li>
          <code>main.js</code>
          は読める状態であるか、バンドル元のソースが添えられている必要があります。
        </li>
        <li>
          難読化されたコード、アナリティクスやトラッキング、リモートコードの読み込みは禁止です。
        </li>
      </ul>
      <p>
        プラグインはアプリの中で、アプリ自身と同じアクセス権を持って実行されます。インストールはユーザーがプラグインごとに下す信頼の判断であり、このレビューはコミュニティの第一の防衛線です。見知らぬ人から渡されても安心してインストールできる、そんなプラグインを書いてください。
      </p>
    </article>
  );
}
