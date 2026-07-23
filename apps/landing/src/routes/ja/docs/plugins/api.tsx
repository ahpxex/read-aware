import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/ja/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "APIリファレンス — ReadAware ドキュメント" },
      {
        name: "description",
        content:
          "ReadAwareプラグイン作成の契約。マニフェスト、ライフサイクル、権限、コントリビューション、ビュー、イベント。",
      },
    ],
  }),
  component: PluginApiPage,
});

function PluginApiPage() {
  return (
    <article className="doc-prose">
      <h1>プラグインAPIリファレンス</h1>
      <p className="lead">
        プラグインは、<code>manifest.json</code>
        と1つのJavaScriptモジュールを収めたフォルダです。このページはプラグイン作成の契約です。同じ契約はTypeScript型宣言ファイル（
        <code>types/plugin-api.d.ts</code>）として
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          マーケットプレイスリポジトリ
        </a>
        に同梱されているので、以下の内容はすべてエディタで補完が効きます。
      </p>

      <h2>構成</h2>
      <pre>
        <code>{`my-plugin/
  manifest.json
  main.js        # 自己完結した単一のESモジュール`}</code>
      </pre>
      <p>
        <code>main.js</code>
        はライフサイクルオブジェクトをデフォルトエクスポートします。プラグインが触れられるものはすべて、
        <code>activate</code>
        に渡されるコンテキスト経由で手に入ります。すべての<code>register*</code>
        呼び出しはdisposableを返し、プラグインが無効化またはアンインストールされたときにアプリが回収します。そのため
        <code>deactivate</code>
        で解放する必要があるのは、プラグイン自身の外部リソースだけです。
      </p>
      <pre>
        <code>{`export default {
  activate(ctx) {
    // ctx経由でコントリビューションを登録する
  },
  deactivate() {
    // 任意：ソケットを閉じる、キューをフラッシュするなど
  },
};`}</code>
      </pre>
      <p>
        有効化・無効化は即座に反映され、アプリの再起動は不要です。TypeScriptで書いてもかまいません（推奨です。
        <Link to="/ja/docs/plugins/publishing">公開する</Link>
        を参照）。アプリが読み込むのは常にビルド済みの<code>main.js</code>です。
      </p>

      <h2>manifest.json</h2>
      <pre>
        <code>{`{
  "id": "anki-sync",
  "name": "Anki Sync",
  "version": "0.1.0",
  "minAppVersion": "0.2.0",
  "description": "Send looked-up words to Anki.",
  "author": "you",
  "permissions": ["network", "reading-data"],
  "main": "main.js"
}`}</code>
      </pre>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>フィールド</th>
              <th>意味</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>id</code>
              </td>
              <td>
                小文字の英字・数字・ハイフン（最大64文字）。フォルダ名と一致している必要があります。プラグインのストレージとツールの名前空間になります。
              </td>
            </tr>
            <tr>
              <td>
                <code>name</code>、<code>version</code>
              </td>
              <td>「設定 → プラグイン」とマーケットプレイスに表示されます。</td>
            </tr>
            <tr>
              <td>
                <code>minAppVersion</code>
              </td>
              <td>プラグインが対応する最低アプリバージョン。</td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                プラグインが使う機能ドメイン（下の表）。インストール前にユーザーへ表示されます。
              </td>
            </tr>
            <tr>
              <td>
                <code>main</code>
              </td>
              <td>
                フォルダからの相対パスで指すエントリーモジュール。既定は
                <code>main.js</code>です。
              </td>
            </tr>
            <tr>
              <td>
                <code>settings</code>
              </td>
              <td>
                任意の宣言的な設定フォーム（フォームビューと同じフィールド形式）。アプリがプラグインパネルに描画し、値をストレージキー
                <code>settings</code>の下に1つのオブジェクトとして保存します。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>権限</h2>
      <p>
        <code>ctx</code>
        上の機能グループは、権限が宣言されていなければそもそも存在しません。意図しない越権をAPIレベルで防ぐ仕組みです。名前空間付きストレージは権限ではなく、すべてのプラグインが持っています。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>権限</th>
              <th>付与されるもの</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>reading-data</code>
              </td>
              <td>
                <code>ctx.reading</code> —本（読み取り）、注釈（作成・削除）、章テキスト、内蔵の単語帳。
                <code>annotation-*</code>イベントにも必要です。
              </td>
            </tr>
            <tr>
              <td>
                <code>library-write</code>
              </td>
              <td>
                <code>ctx.library</code> —書籍ファイルのインポートと、仮想ブックの提供（コンテンツプロバイダー）。
              </td>
            </tr>
            <tr>
              <td>
                <code>network</code>
              </td>
              <td>
                <code>ctx.fetch</code> — 外向きのHTTP。
              </td>
            </tr>
            <tr>
              <td>
                <code>ai</code>
              </td>
              <td>
                <code>ctx.ai.registerTool</code> — 読書アシスタント用のツール。
              </td>
            </tr>
            <tr>
              <td>
                <code>dictionary</code>
              </td>
              <td>
                <code>ctx.dictionary.lookUp</code> —アプリの辞書（リーダーとキャッシュを共有し、ユーザーのAIを使います）。
              </td>
            </tr>
            <tr>
              <td>
                <code>llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code> —ユーザーが設定したアカウントでのワンショットのモデル呼び出し。スレッドもメモリもツールもありません。
              </td>
            </tr>
            <tr>
              <td>
                <code>clipboard</code>
              </td>
              <td>
                <code>ctx.clipboard.writeText</code>。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>コントリビューション</h2>

      <h3>選択アクション</h3>
      <p>
        リーダーの選択メニューと注釈メニューに入る項目です。ハンドラーは選択されたテキスト、そのCFI範囲、章、本を受け取ります。リーダー内でのアクションの結末は、静かに実行される（トーストを返す）か、ダイアログを開く（ビューを返す）かの2通りだけです。
      </p>
      <pre>
        <code>{`ctx.ui.registerSelectionAction({
  id: "save-quote",
  title: "Save quote",
  icon: "quotes",
  run: (input) => {
    // input: { text, cfiRange, chapterHref, book, source }
    return { toast: "Quote saved." };
  },
});`}</code>
      </pre>

      <h3>ヘッダーアクション</h3>
      <p>
        ヘッダーバーに置かれるアイコンボタンです。リーダーのサーフェスでは、ビューはアンカー付きのポップオーバーとして開きます。本棚では
        <code>presentation</code>
        に応じてポップオーバーまたはページ全体として開きます。リーダーがページ全体の割り込みを許すことはありません。
      </p>
      <pre>
        <code>{`ctx.ui.registerHeaderAction({
  id: "reading-report",
  title: "Reading report",
  icon: "chart-line-up",
  surface: "shelf",
  presentation: "page",
  view: async () => ({
    kind: "markdown",
    title: "This week",
    markdown: "You read **4h 12m** across 3 books.",
  }),
});`}</code>
      </pre>

      <h3>コマンド</h3>
      <p>
        コマンドパレットの項目です。プラグインのアクションはすべて自動的にパレットにも現れます。明示的なコマンドは、ボタンを持たない操作のためのものです。
      </p>
      <pre>
        <code>{`ctx.ui.registerCommand({
  id: "sync-now",
  title: "Anki Sync: sync now",
  run: async () => ({ toast: "Synced." }),
});`}</code>
      </pre>

      <h3>エージェントツール</h3>
      <p>
        読書アシスタントがチャット中に呼び出せるツールです（<code>ai</code>
        権限が必要）。<code>parameters</code>
        は引数オブジェクトを表すただのJSON
        Schemaで、引数のないツールでは省略します。ツール名はモデルに届く前に
        <code>plugin_&lt;pluginId&gt;_&lt;name&gt;</code>
        という名前空間が付けられ、呼び出しはチャット内のツールステップとしてユーザーに見えます。
      </p>
      <pre>
        <code>{`ctx.ai?.registerTool({
  name: "search_deck",
  label: "Searching your Anki deck",
  description: "Search the user's Anki collection for a term.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async ({ query }) => {
    const res = await ctx.fetch("http://127.0.0.1:8765", {
      method: "POST",
      body: JSON.stringify({ action: "findNotes", query }),
    });
    return res.json();
  },
});`}</code>
      </pre>

      <h2>ビュー</h2>
      <p>
        プラグインはインターフェイスを宣言的に記述し、アプリが描画します。4種類あります。
      </p>
      <ul>
        <li>
          <code>markdown</code> — マークダウン文字列。アプリが組版します。
        </li>
        <li>
          <code>list</code> — 項目は
          <code>{"{ id, title, subtitle?, icon?, onSelect? }"}</code>。
          <code>onSelect</code>
          が別のビューを返せば、ドリルダウンできます。
        </li>
        <li>
          <code>form</code> —フィールド（text、textarea、number、select、toggle）と
          <code>onSubmit</code>
          。値を受け取り、結果のビューまたはフィールドエラーを返せます。
        </li>
        <li>
          <code>blocks</code> —ブロックの順序付きの並びです。マークダウン、見出し、辞書エントリー、キーと値の行、引用、アクションボタン、区切り線、あるいは入れ子のリスト/フォーム。より豊かなページへの成長経路です。
        </li>
      </ul>
      <p>
        ハンドラー（<code>run</code>、<code>onSelect</code>、
        <code>onSubmit</code>）はすべて同じ形の結果を返します。
      </p>
      <ul>
        <li>何も返さない — サーフェスは現状のまま。</li>
        <li>
          <code>{"{ toast: \"…\" }"}</code> — 一時的な通知。
        </li>
        <li>
          <code>{"{ view }"}</code> — サーフェスを開く、またはその上に積む。
        </li>
        <li>
          <code>{"{ close: true }"}</code> — サーフェスを閉じる（
          <code>toast</code>と組み合わせ可能）。
        </li>
        <li>
          <code>{"{ fieldErrors }"}</code> —フォーム送信から。フォームに留まり、フィールドの下にエラーを表示します。
        </li>
      </ul>
      <p>
        非同期処理は特別なことではありません。Promiseを返せば、アプリが読み込み状態を表示します。アイコンはアプリが厳選したPhosphorセットから名前で選びます。カスタムSVGはありません。
      </p>

      <h2>イベント</h2>
      <p>
        <code>ctx.events.on(event, handler)</code>はdisposableを返します。
        <code>annotation-*</code>イベントには<code>reading-data</code>
        権限が必要で、それ以外は常時利用できます。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>イベント</th>
              <th>ペイロード</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>book-opened</code>
              </td>
              <td>
                <code>{"{ book: { id, title, author? } }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>book-closed</code>
              </td>
              <td>
                <code>{"{ bookId }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>chapter-changed</code>
              </td>
              <td>
                <code>{"{ bookId, chapterHref }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>reading-progress</code>
              </td>
              <td>
                <code>{"{ bookId, fraction }"}</code> —ページをめくるたびに発火します。fractionは0..1です
              </td>
            </tr>
            <tr>
              <td>
                <code>book-removed</code>
              </td>
              <td>
                <code>{"{ bookId }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>annotation-created</code>
              </td>
              <td>
                <code>{"{ annotation }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>annotation-deleted</code>
              </td>
              <td>
                <code>{"{ id }"}</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>読書データ</h2>
      <p>
        <code>reading-data</code>があると、<code>ctx.reading</code>
        からユーザーの読書の足跡にアクセスできます。
      </p>
      <ul>
        <li>
          <code>listBooks()</code>、<code>listAnnotations(filter?)</code>。
        </li>
        <li>
          <code>createHighlight(…)</code>、<code>createNote(…)</code>、
          <code>updateNote(…)</code>、<code>recolorHighlight(…)</code>、
          <code>deleteAnnotation(id)</code>。
        </li>
        <li>
          <code>getToc(bookId)</code>と
          <code>getChapterText(bookId, index)</code> —本の章リストとプレーンテキスト（抽出はオンデマンドで実行されます）。
        </li>
        <li>
          <code>vocabulary.list / add / remove</code> —リーダーの辞書が保存先にしているのと同じ単語帳。
        </li>
      </ul>

      <h2>ライブラリと仮想ブック</h2>
      <p>
        <code>library-write</code>
        があると、プラグインは本物の本を本棚に置けます。<code>importBook</code>
        はファイルのバイト列を受け取ります。コンテンツプロバイダーはファイルを完全に省略します。プロバイダーを登録し、それに紐づく仮想ブックを追加し、本が開かれたときにHTMLセクションを供給します。リーダーはほかの本と同じようにページ分割し、注釈を付け、進捗を記録します。本としてのRSSフィードは、まさにこの仕組みです。
      </p>
      <pre>
        <code>{`ctx.library?.registerContentProvider({
  id: "rss",
  async load(key) {
    const feed = await fetchFeed(key); // 自分のコード（ctx.fetch経由）
    return {
      title: feed.title,
      sections: feed.items.map((item) => ({
        title: item.title,
        html: item.contentHtml,
      })),
    };
  },
});

await ctx.library?.addVirtualBook({
  providerId: "rss",
  key: "https://example.com/feed.xml",
  title: "Example Weekly",
});`}</code>
      </pre>

      <h2>ストレージと設定</h2>
      <p>
        <code>ctx.storage</code>
        は名前空間付きのキーバリューストアで、アプリのローカルデータとともに永続化されます。
        <code>get</code>、<code>set</code>、<code>remove</code>
        があります。マニフェストが<code>settings</code>
        フィールドを宣言していれば、アプリがそのフォームを描画し、値は
        <code>ctx.storage.get("settings")</code>
        に1つのオブジェクトとして届きます。
      </p>

      <h2>常時使えるコンテキスト</h2>
      <p>権限なしで、いつでも使えます。</p>
      <ul>
        <li>
          <code>ctx.manifest</code>、<code>ctx.appVersion</code>。
        </li>
        <li>
          <code>ctx.ui.showToast(message)</code>。
        </li>
        <li>
          <code>ctx.reader.openBook(bookId)</code>と
          <code>ctx.reader.goTo({"{ bookId?, cfi?, href? }"})</code> —リーダーを操作します（ユーザーに見える操作のみで、データは公開しません）。
        </li>
      </ul>

      <h2>安定性</h2>
      <p>
        APIサーフェスは意図的に小さく保たれ、追加によってのみ成長します。新しいブロック種、新しいイベント、新しい機能グループという形です。ここに記載された内容への破壊的変更はバグとして扱います。最近の追加機能に依存する場合は
        <code>minAppVersion</code>を宣言してください。
      </p>
    </article>
  );
}
