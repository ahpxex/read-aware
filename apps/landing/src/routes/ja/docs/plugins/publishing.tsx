import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/ja/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "プラグインの公開 — ReadAwareドキュメント" },
      {
        name: "description",
        content:
          "ReadAwareプラグインを準備、検証、レビューし、公開マーケットプレイスのリポジトリへ提出する方法。",
      },
    ],
  }),
  component: PublishingPage,
});

function PublishingPage() {
  return (
    <article className="doc-prose">
      <h1>プラグインの公開</h1>
      <p className="lead">
        マーケットプレイスのパッケージは公開の{" "}
        <a
          href={MARKETPLACE_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          readaware-pluginsリポジトリ
        </a>
        に置かれ、レビューを経て登録されます。現在のカタログはファーストパーティのみですが、この手順は外部からの提出を受け付ける場合にも契約となります。
      </p>

      <h2>レビュー可能なパッケージを準備する</h2>
      <p>
        TypeScriptの使用を推奨します。レビュー担当者がソースと成果物を比較できるよう、
        <code>src/</code>をビルド済みで自己完結した<code>main.js</code>
        の隣に置きます。ランタイムで使うアセットはすべてコミットしてください。リモートコードを読み込んだり、生成された巨大データに動作を隠したり、パッケージ外のファイルに依存したりしないでください。
      </p>
      <pre>
        <code>{`plugins/my-plugin/
  manifest.json
  main.js
  package.json
  tsconfig.json
  src/main.ts
  assets/…`}</code>
      </pre>

      <h2>リポジトリのチェックを実行する</h2>
      <pre>
        <code>{`bun run build
bun run typecheck
bun test
bun run validate`}</code>
      </pre>
      <p>
        検証では、レジストリとマニフェストの整合性、ID、バージョン、ケイパビリティ要件、権限、宣言されたファイル、パッケージ構成を確認します。これらのチェックは必要ですが十分ではありません。提出前にReadAwareデスクトップでビルド済みフォルダーを実際に動かしてください。
      </p>

      <h2>提出する</h2>
      <ol>
        <li>公開リポジトリをフォークします。</li>
        <li>
          テンプレートを<code>plugins/&lt;plugin-id&gt;/</code>
          へコピーし、フォルダー名をマニフェストIDと一致させます。
        </li>
        <li>パッケージと、必要なランタイムアセットをすべて追加します。</li>
        <li>
          ID順に並べた対応するエントリを<code>registry.json</code>へ追加します。
        </li>
        <li>
          ルートの4つのチェックをすべて実行し、ビルド済みフォルダーからのローカルインストールをテストします。
        </li>
        <li>
          動作、プライベートデータ、外部サービス、各権限と設定許可の理由を説明するプルリクエストを作成します。
        </li>
      </ol>

      <h2>レビューチェックリスト</h2>
      <ul>
        <li>
          機能が既存のドメイン、コントリビューション、サービスのうち、最も狭い範囲のケイパビリティを使っている。
        </li>
        <li>
          <code>requires</code>
          に使用するすべての契約が、妥当なsemver範囲とともに記載されている。
        </li>
        <li>
          権限と<code>settingsAccess</code>
          が実際のランタイム呼び出しと一致し、推測に基づく権限を含んでいない。
        </li>
        <li>
          <code>activate()</code>
          は動作を登録するだけで、業務上または外部への副作用を実行しない。
        </li>
        <li>
          プラグイン専用データに安定したスキーマがあり、すべてのバージョン移行にテスト済みのマイグレーションがある。
        </li>
        <li>
          ネットワークエンドポイント、LLMの利用、認証情報、スケジュール、データ保持について、ユーザー向けの言葉で説明されている。
        </li>
        <li>
          ホスト描画ビューが、キーボードナビゲーション、長いテキスト、空データ、ライトテーマとダークテーマに対応している。
        </li>
        <li>
          ソースが読みやすく、生成物を再現でき、アナリティクス、トラッキング、難読化、リモートコードの読み込みが存在しない。
        </li>
      </ul>
      <p>
        <Link to="/ja/docs/plugins/capabilities">権限プレビュー</Link>
        は提出前の確認に役立ちます。正式なチェックは、リポジトリの検証と人によるレビューです。
      </p>

      <h2>更新とデータマイグレーション</h2>
      <p>
        <code>manifest.json</code>と<code>registry.json</code>
        の両方でパッケージバージョンを上げます。<code>schemaVersion</code>
        を上げるのは、プライベートKVまたはドキュメントの構造が変わる場合だけにし、対応する
        <code>migrate()</code>を同じ候補に含めます。
      </p>
      <p>
        現実的なデータを使って、更新と意図的なダウングレードをテストします。ReadAwareは候補をステージングしてヘルスチェックを行い、プラグインのファイルとデータをスナップショットし、マイグレーション中は旧ランタイムを静止させ、成功した後にだけ昇格させます。更新に失敗しても、以前のパッケージとデータを引き続き使用できなければなりません。
      </p>

      <h2>権限の変更</h2>
      <p>
        新しい権限は、マニフェストの整理ではなくプロダクトの変更として扱います。以前の権限セットでは不十分な理由、アクセス可能になるユーザーデータまたは外部操作、ユーザーが拒否した場合の結果を説明します。コードが使わなくなった権限は削除してください。
      </p>

      <h2>現在の配布における信頼性</h2>
      <p>
        Workerの分離とケイパビリティの強制により過剰な権限行使は抑えられますが、インストールが信頼に基づく判断であることは変わりません。広く第三者に開かれたマーケットプレイスにする前に、ReadAwareには発行者の身元確認、決定論的なパッケージング、署名と完全性の検証、レビューの出所情報、失効、権限差分のレビュー、セキュリティ対応経路が必要です。
      </p>
      <p>
        これらの仕組みが提供されるまでは、リポジトリにマージされたエントリはレビューの証拠であって、任意の悪意あるコードが安全だという数学的保証ではありません。
      </p>

      <h2>プルリクエストを作成する前に</h2>
      <p>
        <Link to="/ja/docs/plugins/develop">プラグインをビルドする</Link>
        を読み直し、最終マニフェストを
        <Link to="/ja/docs/plugins/capabilities">ケイパビリティツール</Link>
        で比較し、古い<code>shelf</code>や<code>appearance</code>
        の例ではなく、現在の<Link to="/ja/docs/plugins/api">API契約</Link>
        にパッケージが従っていることを確認します。
      </p>
    </article>
  );
}
