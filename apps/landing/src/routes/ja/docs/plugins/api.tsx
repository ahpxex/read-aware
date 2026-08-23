import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/ja/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "プラグインAPIリファレンス — ReadAwareドキュメント" },
      {
        name: "description",
        content:
          "現在のReadAwareプラグイン契約: マニフェスト、ケイパビリティ、ドメイン、コントリビューション、サービス、宣言的UI、ライフサイクル、マイグレーション。",
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
        プラグインは<code>manifest.json</code>
        とビルド済みESモジュールを含むフォルダーです。公開されるTypeScript契約の正確な定義は{" "}
        <a
          href={MARKETPLACE_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          readaware-pluginsリポジトリ
        </a>
        の<code>types/plugin-api.d.ts</code>
        として提供されています。このページでは各要素の関係を説明します。
      </p>

      <h2>パッケージ構成</h2>
      <pre>
        <code>{`my-plugin/
  manifest.json
  main.js
  src/main.ts       # 推奨。レビュー用にコミット
  assets/           # 任意。マーケットプレイスへのインストール時に明示的に列挙`}</code>
      </pre>
      <p>
        <code>main.js</code>はライフサイクルオブジェクトをdefault
        exportします。ReadAwareは専用のモジュールWorkerで実行し、
        <code>activate</code>にはアクター単位のコンテキストを渡します。
      </p>
      <pre>
        <code>{`export default {
  activate(ctx) {
    // 検査して登録する。この段階では副作用がブロックされる。
  },
  migrate(storageCtx, change) {
    // 任意: プラグイン専用のKVとドキュメントを変換する。
  },
  deactivate() {
    // 任意: プラグイン自身の外部リソースを解放する。
  },
};`}</code>
      </pre>

      <h2>マニフェスト</h2>
      <pre>
        <code>{`{
  "id": "theme-schedule",
  "name": "テーマスケジュール",
  "version": "0.1.0",
  "schemaVersion": 1,
  "minAppVersion": "0.3.0",
  "requires": {
    "domains": { "settings": "^1.0.0" },
    "contributions": {
      "commands": "^1.0.0",
      "settingsOptions": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "ui": "^1.0.0"
    },
    "schemas": { "settings": "^1.0.0" }
  },
  "settingsAccess": {
    "discover": ["appearance.theme", "reading.theme"],
    "write": ["appearance.theme", "reading.theme"]
  },
  "main": "main.js"
}`}</code>
      </pre>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>フィールド</th>
              <th>契約</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>id</code>
              </td>
              <td>
                小文字、数字、ハイフンで構成し、最大64文字。恒久的な名前空間であり、フォルダー名と一致させます。
              </td>
            </tr>
            <tr>
              <td>
                <code>name</code>、<code>version</code>
              </td>
              <td>ユーザー向けの名前とパッケージバージョン。</td>
            </tr>
            <tr>
              <td>
                <code>schemaVersion</code>
              </td>
              <td>
                プラグイン専用KVとドキュメントデータ用の必須の正整数。パッケージバージョンとは独立します。
              </td>
            </tr>
            <tr>
              <td>
                <code>requires</code>
              </td>
              <td>
                ケイパビリティIDからsemver範囲への必須マップ。ドメイン、コントリビューション、サービス、スキーマごとにグループ化します。
              </td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                ユーザーに要求する任意の意味的権限。不明な値は検証に失敗します。
              </td>
            </tr>
            <tr>
              <td>
                <code>settingsAccess</code>
              </td>
              <td>
                正確な設定パスまたは明示的な<code>section.*</code>
                グループに対する、任意のdiscover/read/write許可。
              </td>
            </tr>
            <tr>
              <td>
                <code>minAppVersion</code>
              </td>
              <td>
                任意のアプリバージョン下限。新しく提供されたケイパビリティに依存する場合に使用します。
              </td>
            </tr>
            <tr>
              <td>
                <code>settings</code>
              </td>
              <td>ホストが描画する任意のプラグイン設定フィールド。</td>
            </tr>
            <tr>
              <td>
                <code>schedules</code>
              </td>
              <td>
                任意の繰り返しタスク。ハンドラーをバインドする前に宣言します。
              </td>
            </tr>
            <tr>
              <td>
                <code>themes</code>、<code>fonts</code>
              </td>
              <td>
                任意の宣言的テーマおよびフォントのコントリビューション。
                <code>ui:themes</code>が必要です。
              </td>
            </tr>
            <tr>
              <td>
                <code>main</code>
              </td>
              <td>
                フォルダーからの相対パスで示すエントリーモジュール。既定値は
                <code>main.js</code>です。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        完全な一覧と権限の語彙については、
        <Link to="/ja/docs/plugins/capabilities">ケイパビリティブラウザー</Link>
        を参照してください。要件は常に互換性に関する宣言であり、権限を付与するものではありません。
      </p>

      <h2>ランタイムコンテキスト</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>名前空間</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>ctx.manifest</code>
              </td>
              <td>検証済みのマニフェスト（読み取り専用）。</td>
            </tr>
            <tr>
              <td>
                <code>ctx.appVersion</code>、<code>ctx.locale</code>
              </td>
              <td>ホストのバージョンと現在のUIロケール。</td>
            </tr>
            <tr>
              <td>
                <code>ctx.lifecycle.phase</code>
              </td>
              <td>
                <code>activating</code>、<code>migrating</code>、または
                <code>active</code>。
              </td>
            </tr>
            <tr>
              <td>
                <code>ctx.capabilities</code>
              </td>
              <td>
                このプラグインアクターに公開されるケイパビリティのバージョンのみ。
              </td>
            </tr>
            <tr>
              <td>
                <code>ctx.domains</code>
              </td>
              <td>許可された、ReadAwareが所有する状態と振る舞い。</td>
            </tr>
            <tr>
              <td>
                <code>ctx.contributions</code>
              </td>
              <td>プラグインが実装を提供できるレジストリ。</td>
            </tr>
            <tr>
              <td>
                <code>ctx.services</code>
              </td>
              <td>範囲を制限したホスト操作と、プラグイン専用の基盤。</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        権限で制御される名前空間は、許可されていない場合は存在しません。すべてのWorker呼び出しはホスト側でも認可されるため、メソッドを隠すだけがチェックではありません。登録は破棄可能オブジェクトを返し、アクティベーションに失敗した場合やプラグインを無効化した場合は逆順で回収されます。
      </p>

      <h2>ドメイン</h2>
      <p>
        ドメインは<code>queries</code>、任意の<code>commands</code>
        、コミット済みイベントの<code>events.subscribe</code>
        を公開します。コマンドはReadAwareと同じイベントソース型の書き込み経路を使い、
        <code>plugin:&lt;id&gt;</code>
        に帰属します。書き込み権限には読み取り権限も含まれます。
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>ドメイン</th>
              <th>クエリとコマンド</th>
              <th>権限</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>library</code>
              </td>
              <td>
                書籍、メタデータ、元の章テキスト、目次、コレクション。インポート、編集、スター付け、削除、仮想書籍、コレクション操作のコマンド。
              </td>
              <td>
                <code>library:read</code> / <code>library:write</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>reading</code>
              </td>
              <td>
                書籍ごとおよび集計の読書統計。読了にする、書籍を開く、CFIまたはhrefへ移動する操作。
              </td>
              <td>
                <code>reading:read</code> / <code>reading:write</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>annotations</code>
              </td>
              <td>
                ハイライト、ノート、受動的な質問履歴の絞り込み。ハイライトやノートの作成、編集、色変更、削除。
              </td>
              <td>
                <code>annotations:read</code> / <code>annotations:write</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>conversations</code>
              </td>
              <td>
                書籍スレッドの読み取り、グローバルスレッドの一覧、スレッドの読み取り。書き込みはチャットランタイムが担います。
              </td>
              <td>
                <code>conversations:read</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>settings</code>
              </td>
              <td>
                許可されたカタログ項目の検出、解決済みの値の読み取り、対応する対象の更新、コミット済み変更の購読。
              </td>
              <td>
                正確な<code>settingsAccess</code>許可
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <code>shelf</code>や<code>appearance</code>
        ドメインはありません。ライブラリデータと現在の読書の振る舞いは分離されています。外観は設定内のセクションです。
      </p>

      <h3>設定へのアクセス</h3>
      <p>
        <code>discover</code>、<code>read</code>、<code>write</code>
        は独立しています。可能な限り正確なパスを許可し、
        <code>appearance.*</code>
        のようなセクショングループは、その機能が本当にセクション全体を必要とする場合だけ使います。更新はカタログの検証、対象ポリシー、永続化、コミット後の効果を通過します。
      </p>
      <pre>
        <code>{`const entries = await ctx.domains.settings.queries.discover({
  section: "appearance",
});

await ctx.domains.settings.commands.update([
  {
    path: "appearance.theme",
    value: "dark",
    target: { kind: "global" },
  },
]);`}</code>
      </pre>

      <h2>コントリビューション</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>レジストリ</th>
              <th>プラグインが提供するもの</th>
              <th>権限</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>selectionActions</code>
              </td>
              <td>
                トーストまたはホスト描画ビューを返す選択アクションとハンドラー。
              </td>
              <td>なし</td>
            </tr>
            <tr>
              <td>
                <code>headerActions</code>
              </td>
              <td>
                リーダーまたはライブラリのアクション、配置メタデータ、ビューコールバック。
              </td>
              <td>なし</td>
            </tr>
            <tr>
              <td>
                <code>commands</code>
              </td>
              <td>コマンドのメタデータとハンドラー。</td>
              <td>なし</td>
            </tr>
            <tr>
              <td>
                <code>settingsOptions</code>
              </td>
              <td>宣言済みの1つのプラグインフィールドに対する動的な選択肢。</td>
              <td>なし</td>
            </tr>
            <tr>
              <td>
                <code>voiceProviders</code>
              </td>
              <td>音声リストとエンコード済み音声の合成。</td>
              <td>なし</td>
            </tr>
            <tr>
              <td>
                <code>contentProviders</code>
              </td>
              <td>仮想書籍キーのセクション。</td>
              <td>なし</td>
            </tr>
            <tr>
              <td>
                <code>readerModes</code>
              </td>
              <td>
                範囲を制限したリーダー分割モード。現在はバンドルされたものに限定。
              </td>
              <td>
                <code>reader:modes</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>agentTools</code>
              </td>
              <td>ツールスキーマ、人間向けラベル、説明、実行関数。</td>
              <td>
                <code>agent:tools</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>agentContextProviders</code>
              </td>
              <td>範囲を制限した現在ターンの参照ブロック。</td>
              <td>
                <code>agent:context</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>agentRetrievalProviders</code>
              </td>
              <td>プラグインが所有するデータからの検索結果。</td>
              <td>
                <code>agent:retrieval</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>memoryCandidateProviders</code>
              </td>
              <td>永続化候補となる事実、嗜好、洞察、要約。</td>
              <td>
                <code>agent:memory</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>themes</code>、<code>fonts</code>
              </td>
              <td>
                マニフェストで宣言する意味的なテーマおよびフォントデータ。
              </td>
              <td>
                <code>ui:themes</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        すべてのコントリビューションIDはプラグインごとの名前空間に属し、すべての登録は所有者を追跡でき検査可能です。古い破棄可能オブジェクトが新しい置き換えを削除することはありません。新しいコントリビューション種別には、意図的に用意したホスト側の利用者が必要です。それが用意されれば、アプリ側で名前を列挙しなくても互換性のあるプラグインを登録できます。
      </p>

      <h3>エージェント拡張の境界</h3>
      <ul>
        <li>
          <strong>コンテキストプロバイダー</strong>
          は1ターンだけ実行されます。ホストは出所情報を付加し、サイズを制限し、出力を信頼されていない参照データとしてシリアライズします。
        </li>
        <li>
          <strong>検索プロバイダー</strong>は、ホストが所有する
          <code>query</code>/<code>limit</code>
          スキーマと切り詰めた結果を持つ、名前空間付きのツールになります。
        </li>
        <li>
          <strong>メモリ候補プロバイダー</strong>
          はターン後に範囲を制限した候補を提案します。ホストがスコープを検証し、重複を排除し、必要な永続書き込みを実行します。
        </li>
      </ul>
      <p>
        プラグインがメモリポートを受け取ることはなく、システムルールを注入したり、長期メモリへ直接書き込んだりすることもできません。
      </p>

      <h2>ホストサービス</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>サービス</th>
              <th>契約</th>
              <th>権限</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>storage</code>
              </td>
              <td>名前空間付きKV、ドキュメントコレクション、外部変更通知。</td>
              <td>なし</td>
            </tr>
            <tr>
              <td>
                <code>secrets</code>
              </td>
              <td>名前空間付きの暗号化認証情報スロット。</td>
              <td>なし</td>
            </tr>
            <tr>
              <td>
                <code>ui</code>
              </td>
              <td>ホストのトーストと保存・エクスポート処理。</td>
              <td>なし</td>
            </tr>
            <tr>
              <td>
                <code>schedules</code>
              </td>
              <td>マニフェストで宣言した間隔にハンドラーをバインド。</td>
              <td>なし</td>
            </tr>
            <tr>
              <td>
                <code>session</code>
              </td>
              <td>範囲を制限した読書セッション情報を購読。</td>
              <td>なし</td>
            </tr>
            <tr>
              <td>
                <code>network</code>
              </td>
              <td>ホストを介したHTTP。</td>
              <td>
                <code>service:network</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>llm</code>
              </td>
              <td>
                ユーザー設定を使い、テキストまたはJSONスキーマで制約したモデル呼び出しを1回実行。
              </td>
              <td>
                <code>service:llm</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>clipboard</code>
              </td>
              <td>システムクリップボードへテキストを書き込み。</td>
              <td>
                <code>service:clipboard</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>ストレージ</h3>
      <p>
        小さな設定やチェックポイントにはKVを使います。安定したIDと任意の
        <code>bookId</code>/<code>anchor</code>
        出所情報を持つ、プラグイン所有レコード用の名前付きドキュメントコレクションを使います。出所情報はインデックスであり所有権ではないため、参照先の書籍を削除してもドキュメントが残ることがあります。アンインストールではドキュメントコレクションを消去しますが、再インストールとマイグレーションのためKV、シークレットスロット、コミット済みスキーマメタデータは保持します。
      </p>

      <h3>スケジュール</h3>
      <p>
        マニフェストは<code>{`{ id, label, everyMinutes }`}</code>
        を宣言し、アクティベーション時に<code>ctx.services.schedules.bind</code>
        を通じてハンドラーをバインドします。最短間隔は15分です。アプリが開いている間は少なくともその間隔で実行され、期限を過ぎていれば起動後に追いつき、重複実行はしません。永続的なバックグラウンドジョブでも、厳密な時刻を保証するものでもありません。
      </p>

      <h2>宣言的UIと設定</h2>
      <p>
        プラグインは実行可能なUIではなく、バージョン管理されたビューのデータを返します。ビューの文法には、Markdown、検索可能なリスト、フォーム、詳細レイアウト、辞書結果、範囲を制限したブロックツリーが含まれます。ハンドラーはサーフェスを維持する、トーストを表示する、ビューを開くまたは置き換える、ナビゲーションをリセットする、サーフェスを閉じる、フィールドエラーを返す、といった操作を行えます。Promiseの読み込み中と失敗の状態はホストが管理します。
      </p>
      <p>
        マニフェスト設定では、text、textarea、number、time、select、choice、checkbox、toggle、secretの各フィールドにホストのコントロールを使います。条件付きフィールドには
        <code>visibleWhen</code>を使い、動的なselectには登録済みの
        <code>settingsOptions</code>
        プロバイダーを使います。secretフィールドは暗号化されたシークレットスロットへ直接書き込み、通常の設定オブジェクトやエージェントから見えるカタログには入りません。
      </p>

      <h2>テーマとフォント</h2>
      <p>
        テーマプラグインはマニフェストで意味的なデータを宣言します。アプリテーマは固定されたホストトークンの語彙を上書きし、リーダーテーマは必須の6色によるページパレットと任意のタイポグラフィ既定値を提供します。ホストは値を検証し、CSSを生成し、承認済みのローカルフォントファイルを読み込みますが、ユーザーが選択するまで適用しません。
      </p>
      <p>
        選択肢の提供には<code>ui:themes</code>が必要です。選択には
        <code>appearance.theme</code>や<code>reading.theme</code>
        など、設定への正確な書き込み許可が必要です。一方が他方を意味することはありません。
      </p>

      <h2>ライフサイクル段階</h2>
      <ol>
        <li>
          <strong>アクティベーション中:</strong>{" "}
          クエリとプラグイン専用の読み取りが利用可能です。登録はステージングされ、副作用はブロックされます。
        </li>
        <li>
          <strong>マイグレーション中:</strong>{" "}
          プラグインのKVとドキュメントコレクションだけが利用可能です。
        </li>
        <li>
          <strong>アクティブ:</strong>{" "}
          昇格されたハンドラーは、許可されたドメイン、コントリビューション、サービスを利用できます。
        </li>
      </ol>
      <p>
        ホストはアクティベーションRPCを排出し、Workerのヘルスチェックを行い、必要なデータマイグレーションを実行してから、ステージング済みの一式を明示的な1時点で昇格させます。アクティベーションに失敗した場合はステージング中の処理を破棄し、現在のランタイムを置き換えません。
      </p>

      <h2>Worker環境</h2>
      <p>
        React、Jotai、DOM、WebView、Tauri、SQLite、ファイルシステム、プロセスへのアクセスはありません。グローバルな
        <code>fetch</code>
        、WebSocket、EventSource、XMLHttpRequest、BroadcastChannel、IndexedDB、Cache
        Storageは無効化されています。ネットワーク、永続化、あらゆるホストとのやり取りには型付きコンテキストを使います。
      </p>

      <h2>互換性と安定性</h2>
      <p>
        ドメイン、コントリビューション、サービス、宣言的スキーマは、それぞれ独立したセマンティックバージョンを持ちます。不明なID、無効なsemver範囲、アクセスできない必須ケイパビリティ、互換性のないホストバージョンがあるとアクティベーションを阻止します。互換性のある追加では、グローバルなプラグインAPI番号ではなく、所有するケイパビリティのバージョンを上げます。
      </p>
      <p>
        現在のエコシステムはファーストパーティのみであるため、現行のレジストリに基づく契約が基準です。以前の
        <code>shelf</code>、<code>appearance</code>
        、またはレジストリ導入前の構造に依存しないでください。
      </p>
    </article>
  );
}
