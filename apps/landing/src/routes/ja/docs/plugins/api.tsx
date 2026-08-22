import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/ja/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "APIリファレンス — ReadAware ドキュメント" },
      {
        name: "description",
        content:
          "ReadAwareプラグイン作成の契約。マニフェスト、ライフサイクル、ドメイン由来の権限、データAPI、コントリビューション、ビュー、イベント。",
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
        と<code>on</code>
        の呼び出しはdisposableを返し、プラグインが無効化またはアンインストールされたときにアプリが回収します。そのため
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
  "minAppVersion": "0.3.0",
  "description": "Send looked-up words to Anki.",
  "author": "you",
  "permissions": ["service:network", "annotations:read"],
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
              <td>
                プラグインが対応する最低アプリバージョン。この契約には
                <code>0.3.0</code>以降が必要です。
              </td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                プラグインが使うもの（下の表）。インストール前にユーザーへ表示されます。
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
                任意の宣言的な設定（フォームビューと同じフィールド形式に加えて
                <code>secret</code>）。アプリが設定画面にプラグイン専用のセクションとして描画し、値をストレージキー
                <code>settings</code>の下に1つのオブジェクトとして保存します。
                <a href="#storage-and-settings">ストレージと設定</a>を参照。
              </td>
            </tr>
            <tr>
              <td>
                <code>schedules</code>
              </td>
              <td>
                任意の定期タスク。インストール前にユーザーへ見えるようここで宣言します。
                <a href="#scheduled-work">定期タスク</a>を参照。
              </td>
            </tr>
            <tr>
              <td>
                <code>themes</code>、<code>fonts</code>
              </td>
              <td>
                任意の宣言的なテーマと同梱フォント（<code>ui:themes</code>
                権限が必要）。
                <a href="#themes-and-bundled-fonts">テーマと同梱フォント</a>
                を参照してください。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>ドメインモデル</h2>
      <p>
        データサーフェスは、アプリのドメインモデルの傍らで別途書き起こされたものではなく、ドメインモデルそのものから導出されています。各ドメイン
        — <code>shelf</code>
        （蔵書・コレクション・読書統計を束ねる、ライブラリ管理の全体）、
        <code>annotations</code>、<code>conversations</code> —は
        <code>ctx</code>上の名前空間で、次の3つを公開します。
      </p>
      <ul>
        <li>
          <strong>reads</strong> —ドメインの読み取りモデル（アプリ自身のサーフェスが描画しているのと同じもの）。
        </li>
        <li>
          <strong>writes</strong> — <code>.write</code>
          の下のコマンド。ドメインのイベント動詞と正確に対応し、アプリ自身のイベントソーシングされた書き込み経路を通ります。イベントログには
          <code>plugin:&lt;id&gt;</code>
          と刻印されるため、プラグインによる書き込みはすべて出所をたどれます。
        </li>
        <li>
          <strong>subscriptions</strong> —{" "}
          <code>.on(event, handler)</code>
          で、そのドメインのイベントを正準名（<code>book.starred</code>、
          <code>highlight.created</code>
          など）で購読します。アプリ自身が記録しているのと同じ語彙です。
        </li>
      </ul>
      <p>
        権限も同じ形に従います。<code>&lt;domain&gt;:read</code> /{" "}
        <code>&lt;domain&gt;:write</code>で、同一ドメイン内では
        <strong>writeはreadを含みます</strong>
        。デバイスローカルな状態（表示設定、リーダーの外観、同期の内部状態）と自由形式の描画は、意図的にプラグインのサーフェスから外しています。UIは後述の宣言的なビューを通ります。
      </p>

      <h2>権限</h2>
      <p>
        <code>ctx</code>
        上の機能グループは、権限が宣言されていなければそもそも存在しません。意図しない越権をAPIレベルで防ぐ仕組みです。名前空間付きストレージ、UIコントリビューション、セッションイベント、リーダーのナビゲーションは権限ではなく、すべてのプラグインが持っています。
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
                <code>shelf:read</code>
              </td>
              <td>
                <code>ctx.shelf</code>
                —本（目次と章テキストを含む）、コレクションとその所属、そして読書統計（
                <code>stats.forBook</code> / <code>stats.list</code> /{" "}
                <code>stats.overview</code>
                。統計に書き込み面はありません。そのイベントはリーダーの活動を記録した事実であって、ユーザーのコマンドではないからです）。
              </td>
            </tr>
            <tr>
              <td>
                <code>shelf:write</code>
              </td>
              <td>
                <code>ctx.shelf.books.write</code>
                —ファイルのインポート、メタデータの編集、スター、読了マーク、削除。加えてコンテンツプロバイダーと仮想ブック。
                <code>ctx.shelf.collections.write</code>
                —作成、名前変更、削除、本の割り当て。
              </td>
            </tr>
            <tr>
              <td>
                <code>annotations:read</code> / <code>annotations:write</code>
              </td>
              <td>
                <code>ctx.annotations</code> —ハイライト、メモ、そして尋ねられた質問（ask）。ハイライトとメモの作成・色の変更・編集・削除ができます（askはエージェントが書き込むもので、読み取り専用です）。
              </td>
            </tr>
            <tr>
              <td>
                <code>conversations:read</code>
              </td>
              <td>
                <code>ctx.conversations</code> —本ごとのAIスレッドとグローバルスレッド（読み取り専用）。
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:themes</code>
              </td>
              <td>
                宣言的なマニフェストフィールド<code>themes</code> /{" "}
                <code>fonts</code>
                （後述）—アプリとリーダーのテーマ、および同梱フォント。権限を要する唯一のUIコントリビューションです。アプリ全体の見た目に対する影響力を持つため、インストール時の同意画面に必ず表示されます。
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:appearance</code>
              </td>
              <td>
                <code>ctx.appearance</code> —— 2つの外観サーフェスが提供する全テーマの列挙、現在の外観の取得、アプリのテーマや本文ページ配色の切り替え。{" "}
                <code>ui:themes</code>{" "}
                とは意図的に別：テーマを提供するのは受動的だが、切り替えるのはそうではない。
              </td>
            </tr>
            <tr>
              <td>
                <code>agent:tools</code>
              </td>
              <td>
                <code>ctx.agent.registerTool</code> —読書アシスタント用のツール。
              </td>
            </tr>
            <tr>
              <td>
                <code>service:network</code>
              </td>
              <td>
                <code>ctx.network.fetch</code>
                —アプリのネイティブHTTPクライアント経由の外向きHTTP（CORSの制約はありません）。
              </td>
            </tr>
            <tr>
              <td>
                <code>service:llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code>
                —ユーザーが設定したアカウントでのワンショットのモデル呼び出し。スレッドもメモリもツールもありません。
                <code>schema</code>による構造化JSON出力と、<code>onText</code>
                によるストリーミングに対応します。
              </td>
            </tr>
            <tr>
              <td>
                <code>service:clipboard</code>
              </td>
              <td>
                <code>ctx.clipboard.writeText</code>。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        （<code>reader:modes</code>
        —ホストが描画するガイド付き読書モード—は、この特権的な契約が固まるまで、当面は同梱の公式プラグイン専用です。）
      </p>

      <h2>コントリビューション</h2>

      <h3>選択アクション</h3>
      <p>
        リーダーの選択メニューと注釈メニューに入る項目です。ハンドラーは選択されたテキスト、そのCFI範囲、章、本を受け取ります。リーダーが復元できる場合は、<code>context</code>{" "}
        に選択範囲の前後の文章も入ります。リーダー内でのアクションの結末は、静かに実行される（トーストを返す）か、ダイアログを開く（ビューを返す）かの2通りだけです。
        非同期アクションに <code>presentation: "dialog"</code> を指定すると、ホストは読み込み中のダイアログを即座に開き、<code>run</code> の完了後に同じリクエストへ結果を表示します。
        辞書系のアクションは <code>role: "lookup"</code> を宣言できます。ホストは既存の「調べる」キーボードコマンドをそのプラグインアクションへルーティングし、組み込みの検索経路を二重に持ちません。
      </p>
      <pre>
        <code>{`ctx.ui.registerSelectionAction({
  id: "save-quote",
  title: "Save quote",
  icon: "quotes",
  presentation: "dialog",
  run: (input) => {
    // input: { text, context?, cfiRange, chapterHref, book, source }
    return { toast: "Quote saved." };
  },
});`}</code>
      </pre>

      <h3>ヘッダーアクション</h3>
      <p>
        トップバーに置かれるアイコンボタンです。リーダーのサーフェスでは、ビューはアンカー付きのポップオーバーとして開きます。本棚では
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
        読書アシスタントがチャット中に呼び出せるツールです（
        <code>agent:tools</code>権限が必要）。<code>parameters</code>
        は引数オブジェクトを表すただのJSON
        Schemaで、引数のないツールでは省略します。ツール名はモデルに届く前に
        <code>plugin_&lt;pluginId&gt;_&lt;name&gt;</code>
        という名前空間が付けられ、呼び出しはチャット内のツールステップとしてユーザーに見えます。
      </p>
      <pre>
        <code>{`ctx.agent?.registerTool({
  name: "search_deck",
  label: "Searching your Anki deck",
  description: "Search the user's Anki collection for a term.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async ({ query }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8765", {
      method: "POST",
      body: JSON.stringify({ action: "findNotes", query }),
    });
    return res.json();
  },
});`}</code>
      </pre>

      <h3>読み上げボイスプロバイダー</h3>
      <p>
        <code>ctx.audio.registerVoiceProvider</code>
        は、リーダーの読み上げにテキスト音声合成エンジンを接続します。プラグインの仕事はテキストをエンコード済みの音声バイト列（mp3/wav
        など、webview がデコードできる形式）に変えることだけです。再生、文単位の進行、先読み、追従ハイライトはすべてアプリが担います。登録自体に権限は不要です—合成に必要な能力（ネットワーク、キー）は、プラグイン自身の他の権限で既にゲートされています。
      </p>
      <pre>
        <code>{`ctx.audio.registerVoiceProvider({
  id: "voices",
  label: "My TTS",
  listVoices: () => [{ id: "default", label: "My TTS · warm" }],
  synthesize: async ({ text, voiceId }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8880/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: text, response_format: "mp3" }),
    });
    return res.arrayBuffer();
  },
});`}</code>
      </pre>
      <p>
        登録されたボイスは自動的に採用されます。ユーザーがプラグインを有効化することが選択であり、ホスト側に別のピッカーはありません。合成に失敗した文はシステムボイスにフォールバックするため、読み上げは途切れず品質だけが下がります。プラグインの設定が変わるとボイスは再列挙されます。
      </p>

      <h3 id="scheduled-work">定期タスク</h3>
      <p>
        マニフェストが定期タスクを宣言し、<code>activate</code>
        が実際の処理をバインドします。アプリは起動中、各スケジュールを少なくとも
        <code>everyMinutes</code>
        分ごと（下限15分）に実行し、期限超過分は起動直後に追い付き実行します。正確な時刻は約束されず、アプリが閉じている間は実行されません。同一スケジュールの重複実行はスキップされ、失敗した回は次の周期を待つだけです。
      </p>
      <pre>
        <code>{`// manifest.json
"schedules": [{ "id": "refresh", "label": "Refresh feeds", "everyMinutes": 60 }]

// main.js
ctx.schedule.on("refresh", async () => {
  // 取得・照合し、ドメインAPI経由で書き戻す
});`}</code>
      </pre>

      <h3 id="themes-and-bundled-fonts">テーマと同梱フォント</h3>
      <p>
        <code>ui:themes</code>
        があると、マニフェストは2つの独立したマウントポイント—アプリのクローム（外枠）と本のページ—それぞれに向けたテーマと、プラグインフォルダに同梱するフォントファイルを宣言できます。このコントリビューションは純粋なデータです。アプリがすべての値を検証し、CSSもすべてアプリ自身が生成します。ユーザーが「設定
        → 外観」またはリーダーのページカラーでそのテーマを選ぶまで、何も適用されません。テーマ専用プラグインの
        <code>main.js</code>は{" "}
        <code>{"export default { activate() {} }"}</code>だけで済みます。
      </p>
      <pre>
        <code>{`{
  "permissions": ["ui:themes"],
  "fonts": [
    {
      "id": "my-serif",
      "family": "My Serif",
      "kind": "serif",
      "files": [{ "path": "assets/my-serif-400.woff2", "weight": 400 }]
    }
  ],
  "themes": [
    {
      "id": "dusk",
      "name": { "default": "Dusk", "translations": { "zh-Hans": "暮色" } },
      "polarity": "dark",
      "app": { "paper": "#14171e", "fg": "#e3e6ec" },
      "reader": {
        "palette": {
          "bg": "#161a22", "text": "#ccd2dd",
          "selection": "rgba(154, 162, 177, 0.28)",
          "rule": "rgba(204, 210, 221, 0.18)",
          "faint": "rgba(204, 210, 221, 0.07)",
          "muted": "rgba(204, 210, 221, 0.55)"
        },
        "typography": { "fontFamily": "plugin:my-serif", "fontSize": "large" }
      }
    }
  ]
}`}</code>
      </pre>
      <ul>
        <li>
          <code>polarity</code>
          —テーマがライトとダークのどちらとして読まれるか。
          <code>color-scheme</code>
          、テーマが指定しなかったアプリトークンの極性ごとの既定値、そしてテーマが有効な間リーダーの「自動」ページカラーがどう解決されるかを決めます。
        </li>
        <li>
          <code>app</code>
          —アプリの固定トークン語彙（キャンバス、テキストの階層、サーフェス、フィル、ボーダー。型定義の
          <code>PluginAppThemeTokens</code>
          を参照）への上書きです。指定しなかったトークンは、その極性自身の値を保ちます。
        </li>
        <li>
          <code>reader</code>
          —組み込みのページカラーと同じ6色パレット（6色すべて必須）に加え、任意のタイポグラフィプリセット。プリセットはユーザーがテーマを選んだ瞬間に一度だけ適用され、その後はすべて自由に調整できます。
        </li>
        <li>
          <code>fonts</code> — <code>.woff2</code>/<code>.woff</code>/
          <code>.ttf</code>/<code>.otf</code>
          のフォントフェイスをプラグインフォルダから直接配信します。プラグインが有効な間、それぞれがリーダーのフォントピッカーに現れます。テーマは自分のフォントを
          <code>plugin:&lt;fontId&gt;</code>
          で参照します。マーケットプレイスのプラグインは、フォントファイルをレジストリエントリの
          <code>files</code>に必ず載せてください。
        </li>
        <li>
          色は厳格な文法で検証されます。プレーンな16進数、または
          <code>rgb()</code>/<code>rgba()</code>/<code>hsl()</code>/
          <code>hsla()</code>のみで、キーワード、<code>var()</code>、
          <code>url()</code>は拒否されます。
        </li>
      </ul>

      <h2>ビュー</h2>
      <p>
        プラグインはホストコンポーネントのツリーを宣言し、視覚要素とコントロールはすべてアプリが描画します。JSX、HTML、CSS、className は渡せません。
      </p>
      <ul>
        <li>
          <code>markdown</code> — マークダウン文字列。アプリが組版します。
        </li>
        <li>
          <code>list</code> — 固定 debounce の検索、keywords、accessories、空状態。<code>timeline</code> は今日／今週／今月／すべての絞り込みとローカル日付のグループを追加し、項目の <code>presentation: "dialog"</code> で子ページではなく一覧の上に結果を表示できます。
        </li>
        <li>
          <code>form</code> — ReadAware コンポーネントの text、textarea、number、time、select、choice、checkbox、toggle と
          <code>onSubmit</code>
          。値を受け取り、結果のビューまたはフィールドエラーを返せます。
        </li>
        <li>
          <code>detail</code> — Raycast 型のメインコンテンツ、メタデータ、ホストアクション。ホストはアクションを見出し横のアイコンボタンとして描画し、出典、日付、タグなどのメタデータを静かなフッターにまとめます。
        </li>
        <li>
          <code>blocks</code> — ホストの typography、markdown、辞書、metadata、引用、アクション、指標、進捗、タグ、アラート、section、group、レスポンシブな <code>columns</code>。columns が公開するのは weight、間隔プリセット、最小幅プリセット、意味的な配置だけで、CSS と折り返しはデザインシステムが所有します。宣言は実行時に検証され、ネスト深度も制限されます。
        </li>
      </ul>
      <p>
        ハンドラー（<code>run</code>、<code>onSelect</code>、
        <code>onSubmit</code>）はすべて同じ形の結果を返します。
      </p>
      <ul>
        <li>何も返さない — サーフェスは現状のまま。</li>
        <li>
          <code>{'{ toast: "…" }'}</code> — 一時的な通知。
        </li>
        <li>
          <code>{"{ view }"}</code> — サーフェスを開く、またはその上に積む。
        </li>
        <li>
          <code>{'{ view, navigation: "replace" | "reset" }'}</code> —
          現在のビューを置き換える、または新しいルートビューへ戻る。
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

      <h2>ドメインデータ</h2>
      <p>
        許可された各ドメインの名前空間は、読み取り、正準イベントの購読、そして（write権限があれば）コマンドを提供します。要点は次のとおりです。
      </p>
      <ul>
        <li>
          <code>ctx.shelf.books</code> — <code>list()</code>、
          <code>get(id)</code>、<code>getToc(id)</code>、
          <code>getChapterText(id, index)</code>
          。write: <code>import</code>、<code>editMetadata</code>、
          <code>setStarred</code>、<code>setFinished</code>、
          <code>remove</code>
          、加えてコンテンツプロバイダー（後述）。
        </li>
        <li>
          <code>ctx.shelf.collections</code> — <code>list()</code>、
          <code>booksIn(id)</code>。write: <code>create</code>、
          <code>rename</code>、<code>remove</code>、
          <code>assignBooks(bookIds, collectionId | null)</code>。
        </li>
        <li>
          <code>ctx.shelf.stats</code> — <code>forBook(bookId)</code>、
          <code>list()</code>、<code>overview()</code>
          （読書位置、ステータス、実読書時間。どのアクターに対しても読み取り専用です）。
        </li>
        <li>
          <code>ctx.annotations</code> —{" "}
          <code>list({"{ bookId?, kind?, query? }"})</code>
          はハイライト・メモ・askの判別可能なユニオンを返します。write:{" "}
          <code>createHighlight</code>、<code>recolorHighlight</code>、
          <code>removeHighlight</code>、<code>createNote</code>、
          <code>updateNote</code>、<code>removeNote</code>。
        </li>
        <li>
          <code>ctx.conversations</code> —{" "}
          <code>getBookThread(bookId)</code>、<code>listThreads()</code>、
          <code>getThread(id)</code>。<code>on</code> で購読できます（
          <code>aiConversation.started</code>、<code>aiMessage.appended</code>、
          <code>aiMessage.removed</code>、<code>aiConversation.cleared</code>）。
        </li>
      </ul>

      <h2>イベント</h2>
      <p>
        イベントには、意図的に分けられた2つの種類があります。
        <strong>ドメインイベント</strong>
        はアプリが記録する事実です。ドメインごとに、正準名で、そのドメインのread権限のもとで購読します。届くのはそれぞれ
        <code>{"{ type, payload, createdAt, origin }"}</code>
        で、originはその事実を生み出したソフトウェア上のアクター（
        <code>user</code>、<code>agent</code>、<code>system</code>、
        <code>plugin:&lt;id&gt;</code>のいずれか）を示します。
      </p>
      <pre>
        <code>{`ctx.annotations?.on("highlight.created", ({ payload, origin }) => {
  // payload: { highlightId, bookId, text, color?, … }
});
ctx.shelf?.on("book.removed", ({ payload }) => { /* { bookId } */ });`}</code>
      </pre>
      <p>
        <strong>セッションファクト</strong>
        は、いま画面に何が映っているかを表します。イベントログには決して入らず、権限も不要です。
        <code>ctx.session.on(event, handler)</code>で購読します。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>セッションイベント</th>
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
          </tbody>
        </table>
      </div>

      <h2>コンテンツプロバイダーと仮想ブック</h2>
      <p>
        <code>shelf:write</code>
        があると、プラグインは本物の本を本棚に置けます。<code>import</code>
        はファイルのバイト列を受け取ります。コンテンツプロバイダーはファイルを完全に省略します。プロバイダーを登録し、それに紐づく仮想ブックを追加し、本が開かれたときにHTMLセクションを供給します。リーダーはほかの本と同じようにページ分割し、注釈を付け、進捗を記録します。本としてのRSSフィードは、まさにこの仕組みです。
      </p>
      <pre>
        <code>{`ctx.shelf?.books.write?.registerContentProvider({
  id: "rss",
  async load(key) {
    const feed = await fetchFeed(key); // 自分のコード（ctx.network.fetch経由）
    return {
      title: feed.title,
      sections: feed.items.map((item) => ({
        title: item.title,
        html: item.contentHtml,
      })),
    };
  },
});

await ctx.shelf?.books.write?.addVirtualBook({
  providerId: "rss",
  key: "https://example.com/feed.xml",
  title: "Example Weekly",
});`}</code>
      </pre>

      <h2 id="storage-and-settings">ストレージと設定</h2>
      <p>
        <code>ctx.storage</code>
        は名前空間付きのキーバリューストアで、アプリのローカルデータとともに永続化されます。
        <code>get</code>、<code>set</code>、<code>remove</code>
        があります。マニフェストが<code>settings</code>
        フィールドを宣言していれば、アプリが設定画面にプラグイン専用のセクションとして描画し、値は
        <code>ctx.storage.get("settings")</code>
        に1つのオブジェクトとして届きます。読書アシスタントもこれらの設定を参照・変更できます（
        <code>agentHidden</code>
        を付けたフィールドはアシスタントから見えません）。通常のフォームを超える3つのフィールド能力があります：
      </p>
      <ul>
        <li>
          <code>visibleWhen: {"{ field, equals }"}</code>
          は、別のフィールドが指定値のときだけフィールドを表示します。非表示フィールドの保存値は保持されるため、1つの設定オブジェクトでバリアントごとの値一式を持てます（TTS
          プラグインはこの仕組みでプロバイダーごとにボイスを記憶しています）。
        </li>
        <li>
          <code>select</code>に<code>dynamicOptions: true</code>
          を付けると選択肢を実行時に解決できます。<code>activate</code>で
          <code>ctx.settings.provideOptions(fieldId, async (values) =&gt;
          [...])</code>
          によりソースをバインドします。ソースが選択肢を返せないとき（キー未設定、エンドポイント到達不能）は自由入力のテキストフィールドにフォールバックします—リストは利便であって、ゲートではありません。
        </li>
        <li>
          <code>kind: "secret"</code>
          は資格情報フィールドを宣言します。アプリはパスワード入力を描画し、暗号化されたシークレットストアへ直接書き込みます—フィールド
          id がそのままコードで読み戻す<code>ctx.secrets</code>
          のキーです—平文設定にもアシスタントのカタログにも決して入りません。保存値は再表示されず、フィールドは「設定済み」状態とクリア操作を提示します。
        </li>
      </ul>
      <p>
        構造化データには、<code>ctx.storage.collection(name)</code>
        が名前付きのドキュメントコレクションを開きます。ドキュメント単位のレコードに対する
        <code>put</code> / <code>get</code> / <code>delete</code> /{" "}
        <code>list</code>を備え、任意で<code>bookId</code> /{" "}
        <code>anchor</code>
        の出所情報（provenance）を付けてフィルタできます。出所はインデックスであって所有権ではありません。参照先の本が削除されてもドキュメントは残り、コレクションのライフサイクルはプラグインに属します（アンインストールで消去されます）。組み込みの辞書（Dictionary）プラグイン（単語帳を内包）は、丸ごとこの層の上に作られています。
      </p>

      <h2>常時使えるコンテキスト</h2>
      <p>権限なしで、いつでも使えます。</p>
      <ul>
        <li>
          <code>ctx.manifest</code>、<code>ctx.appVersion</code>、
          <code>ctx.locale</code>
          （アプリUIの現在のBCP-47ロケール。言語設定にライブで追随するので、使う時点で読んでください）。
        </li>
        <li>
          <code>ctx.ui.showToast(message)</code>。
        </li>
        <li>
          <code>ctx.ui.exportFile({"{ filename, content, mimeType? }"})</code>
          —生成したテキスト（CSV、JSON、Markdown）やバイナリのバイト列に対して、ホストの保存フローを開きます。
        </li>
        <li>
          <code>ctx.secrets</code>
          —プラグインごとに名前空間化された暗号化クレデンシャルストア（APIトークンなど）。SQLiteにもバックアップにも入らず、アンインストール後も保持されます。
        </li>
        <li>
          <code>ctx.session.on(…)</code> — 上記のセッションファクト。
        </li>
        <li>
          <code>ctx.reader.openBook(bookId)</code>と
          <code>ctx.reader.goTo({"{ bookId?, cfi?, href? }"})</code> —リーダーを操作します（ユーザーに見える操作のみで、データは公開しません）。
        </li>
      </ul>

      <h2>安定性</h2>
      <p>
        これは契約v2で、アプリ0.3.0から提供されています。サーフェス全体をドメインモデルから導出するために行った、意図的な破壊的再構築です（v1のマニフェストは、読める形のエラーとともにインストールに失敗します）。ここから先、APIは追加によってのみ成長します。新しいドメイン、新しいイベント名、新しいブロック種という形です。宣言的テーマ（<code>ui:themes</code>
        ）がその最初の追加です。ここに記載された内容への破壊的変更はバグとして扱います。最近の追加機能に依存する場合は
        <code>minAppVersion</code>を宣言してください。
      </p>
    </article>
  );
}
