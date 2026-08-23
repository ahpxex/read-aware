import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/ja/docs/plugins/develop")({
  head: () => ({
    meta: [
      { title: "プラグインを作る — ReadAwareドキュメント" },
      {
        name: "description",
        content:
          "公開TypeScriptテンプレートでReadAwareプラグインを作成、検証、インストール、移行、テストする方法。",
      },
    ],
  }),
  component: DevelopPluginPage,
});

function DevelopPluginPage() {
  return (
    <article className="doc-prose">
      <h1>プラグインを作る</h1>
      <p className="lead">
        公開TypeScriptテンプレートから始め、最小限の機能セットを宣言し、ビルド済みパッケージをReadAwareデスクトップアプリで実際に動かします。ライフサイクル、権限、表示、ロールバックはホストが担い、プラグインは自身の振る舞いとプライベートデータを担います。
      </p>

      <h2>前提条件</h2>
      <ul>
        <li>「設定 → プラグイン」にアクセスできるReadAwareデスクトップ。</li>
        <li>
          <a href="https://bun.sh" target="_blank" rel="noopener noreferrer">
            Bun
          </a>
          （リポジトリのスクリプト実行用）。
        </li>
        <li>
          チェックアウトまたはフォークした{" "}
          <a
            href={MARKETPLACE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            readaware-pluginsリポジトリ
          </a>
          。
        </li>
      </ul>

      <h2>パッケージを作成する</h2>
      <ol>
        <li>
          <code>template/</code>を{" "}
          <code>plugins/&lt;your-plugin-id&gt;/</code>へコピーします。
        </li>
        <li>
          フォルダー名、マニフェストの<code>id</code>
          、ランタイム名前空間を同じに保ちます。
        </li>
        <li>
          <code>manifest.json</code>と<code>src/main.ts</code>を編集します。
        </li>
        <li>
          使わないテンプレートのコントリビューションを削除し、対応する権限も削除します。
        </li>
        <li>
          ReadAwareが読み込む自己完結した<code>main.js</code>をビルドします。
        </li>
      </ol>
      <pre>
        <code>{`bun run build
bun run typecheck
bun test
bun run validate`}</code>
      </pre>

      <h2>実装前にマニフェストを設計する</h2>
      <p>次の順序でマニフェストを確認します。</p>
      <ol>
        <li>
          <strong>識別情報</strong> —
          安定したID、名前、パッケージバージョン、作者、最小アプリバージョン。
        </li>
        <li>
          <strong>データ</strong> — 正の整数である<code>schemaVersion</code>
          と移行パス。
        </li>
        <li>
          <strong>互換性</strong> — 使用するすべてのAPIとスキーマについて、
          <code>requires</code>にsemver範囲を記載します。
        </li>
        <li>
          <strong>権限</strong> — 意味的な<code>permissions</code>と正確な
          <code>settingsAccess</code>付与。
        </li>
        <li>
          <strong>宣言</strong> —
          設定、スケジュール、テーマ、フォント、エントリーモジュール。
        </li>
      </ol>
      <p>
        インストール前に{" "}
        <Link to="/ja/docs/plugins/capabilities">
          機能ブラウザーと権限プレビュー
        </Link>{" "}
        を確認してください。要件は互換性の主張であり、ユーザー権限ではありません。権限不要の機能でも、プラグインがその契約に依存するなら
        <code>requires</code>に記載します。
      </p>

      <h2>正しい機能を選ぶ</h2>
      <ol>
        <li>
          ReadAwareが所有する状態や振る舞いには<strong>ドメイン</strong>
          を使います。
        </li>
        <li>
          選択肢、アクション、プロバイダーの提供には
          <strong>コントリビューション</strong>を使います。
        </li>
        <li>
          範囲を限定したホスト操作には<strong>サービス</strong>を使います。
        </li>
        <li>プラグインストレージはプラグイン所有データだけに使います。</li>
        <li>既存の形が合わない場合は、新しい型付きホスト機能を要求します。</li>
      </ol>
      <p>
        本、進捗、注釈、設定、メモリをプラグインストレージへ複製しないでください。シャドー状態は製品の不変条件、コミット済みイベント、プロジェクション再構築、同期の意味論、エージェントコンテキストを迂回します。
      </p>

      <h2>有効化を宣言的に保つ</h2>
      <p>
        <code>activate(ctx)</code>
        では環境を調べ、アクション、コマンド、プロバイダー、購読、スケジュールを登録します。ビジネス書き込みや外部処理は行わないでください。ホストは有効化RPCが完了し、Workerがヘルスチェックに応答するまで、すべての登録をステージします。
      </p>
      <p>
        昇格後は登録済みハンドラーからランタイム処理を開始します。ハンドラーがPromiseを返す場合、読み込み状態と失敗状態の表示はホストに任せます。任意の
        <code>deactivate()</code>
        で閉じる必要がある場合に限り外部リソースへの参照を保持してください。ホストの登録と購読は自動的に破棄されます。
      </p>

      <h2>プライベートデータを明示的にバージョン管理する</h2>
      <p>
        <code>schemaVersion</code>
        はプラグインKVとドキュメントコレクションをバージョン管理し、パッケージバージョンとは独立しています。プライベートデータの形が変わる場合だけ変更してください。スキーマのコミット後に対応するすべてのアップグレードとダウングレードについて、
        <code>migrate(storageCtx, change)</code>をエクスポートします。
      </p>
      <ul>
        <li>
          移行が受け取れるのはストレージだけです。ドメイン、設定、シークレット、ネットワーク、UI、LLM、コントリビューションは使えません。
        </li>
        <li>各遷移を決定的かつ冪等にします。</li>
        <li>
          部分的な書き込み後の失敗をテストし、ホストがKV、ドキュメント、ファイル、スキーマメタデータを正確に復元できることを確認します。
        </li>
        <li>
          パッケージバージョンのチェックをデータスキーマの代わりに使わないでください。
        </li>
      </ul>

      <h2>作業フォルダーをインストールする</h2>
      <ol>
        <li>ビルドとチェックを実行します。</li>
        <li>ReadAwareで「設定 → プラグイン → プラグインをインストール」を開きます。</li>
        <li>
          ビルド済みプラグインフォルダーを選択し、同意内容の概要を確認します。
        </li>
        <li>デスクトップアプリで実際の機能を動かします。</li>
        <li>更新をテストするため、再ビルドして再インストールします。</li>
      </ol>
      <p>
        通常のブラウザーでは、プラグインのインストール、Worker
        IPC、SQLite永続化、生のブックアクセス、リーダー統合、ロールバックを検証できません。出荷対象のTauriアプリでテストしてください。
      </p>

      <h2>成功経路だけでなくライフサイクルをテストする</h2>
      <ul>
        <li>
          再起動せずに、新規インストール、有効化、無効化、再有効化を行います。
        </li>
        <li>実際のデータを使った更新とダウングレードの成功。</li>
        <li>
          有効化のタイムアウト、ハンドラーの拒否、移行失敗、正確なロールバック。
        </li>
        <li>
          アンインストール後の後始末。アクション、リスナー、スケジュール、プロバイダー、Workerが残らないこと。
        </li>
        <li>更新中の権限削除と権限拡張。</li>
        <li>
          長いラベル、空状態、キーボードナビゲーション、すべてのホストテーマ。
        </li>
      </ul>

      <h2>現在の制限を知る</h2>
      <p>
        スケジュールはReadAwareが開いている間、宣言された間隔以上の頻度で実行され、期限を過ぎていれば起動時に追いつきます。永続ジョブではありません。アプリ終了中の実行、永続キュー、再試行・バックオフ契約、クラッシュ後の再開保証はありません。
      </p>
      <p>
        UIは既存の型付きコントリビューションポイントでのみ利用できます。配置場所がない場合は、ホスト所有のコントリビューションとコンシューマーが必要です。任意のHTMLや汎用ネイティブinvoke
        APIを近道として追加することはありません。
      </p>

      <h2>次へ</h2>
      <p>
        エディターの横に<Link to="/ja/docs/plugins/api">APIリファレンス</Link>
        を置き、レジストリへのプルリクエストを準備する前に
        <Link to="/ja/docs/plugins/publishing">公開</Link>を読んでください。
      </p>
    </article>
  );
}
