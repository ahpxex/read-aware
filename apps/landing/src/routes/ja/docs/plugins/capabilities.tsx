import { createFileRoute } from "@tanstack/react-router";
import {
  PluginCapabilityBrowser,
  type PluginCapabilityBrowserCopy,
} from "../../../../components/PluginCapabilityBrowser";
import {
  PluginPermissionPreview,
  type PluginPermissionPreviewCopy,
} from "../../../../components/PluginPermissionPreview";

export const Route = createFileRoute("/ja/docs/plugins/capabilities")({
  head: () => ({
    meta: [
      { title: "プラグイン機能 — ReadAwareドキュメント" },
      {
        name: "description",
        content:
          "バージョン管理されたReadAwareプラグイン機能をすべて確認し、プラグインマニフェストが要求する権限をプレビューします。",
      },
    ],
  }),
  component: PluginCapabilitiesPage,
});

const capabilityCopy: PluginCapabilityBrowserCopy = {
  searchLabel: "機能を検索",
  searchPlaceholder: "ID・権限・用途",
  familyLabel: "機能ファミリー",
  authorityLabel: "権限の種類",
  allFamilies: "すべてのファミリー",
  allAuthorities: "すべての権限",
  familyNames: {
    domains: "ドメイン",
    contributions: "コントリビューション",
    services: "サービス",
    schemas: "スキーマ",
  },
  authorityNames: {
    permission: "権限が必要",
    "permission-free": "追加権限なし",
    "settings-grant": "正確な設定付与",
  },
  permissionFree: "なし",
  versionLabel: "v",
  permissionLabel: "権限",
  capabilityLabel: "機能",
  purposeLabel: "プラグインができること",
  hostOwnsLabel: "ホストが保持するもの",
  result: (count) => `${count}件の機能`,
  noResults: "このフィルターに一致する機能はありません。",
  descriptions: {
    "domains:library": {
      purpose:
        "本、ファイル、メタデータ、目次、コレクションを読み取り、ライブラリ項目をインポートまたは削除します。",
      hostOwns:
        "ライブラリの不変条件、イベントソース型書き込み、ファイル、プロジェクション。",
    },
    "domains:reading": {
      purpose:
        "アクティブなセッションを調べ、位置、進捗、読書時間を更新し、移動します。",
      hostOwns:
        "リーダーのライフサイクル、進捗の意味論、コミット済みイベント。",
    },
    "domains:annotations": {
      purpose: "正規コマンドでハイライトとメモを読み取り、変更します。",
      hostOwns: "検証、帰属、永続化、イベント順序。",
    },
    "domains:conversations": {
      purpose: "本とグローバルスレッドの概要を読み取ります。",
      hostOwns: "会話の書き込み、プロンプト構築、メモリ。",
    },
    "domains:settings": {
      purpose:
        "明示的に許可された設定パスを検出、読み取り、更新し、購読します。",
      hostOwns: "カタログ、対象、検証、永続化、変更効果。",
    },
    "contributions:selectionActions": {
      purpose: "選択メニューと注釈メニューにコマンドを追加します。",
      hostOwns: "メニュー配置、呼び出しUI、読み込み、アクセシビリティ。",
    },
    "contributions:headerActions": {
      purpose:
        "リーダーまたはライブラリのツールバーアクションとホスト描画ビューを追加します。",
      hostOwns: "配置、ナビゲーション、ポップオーバー、ページ、フォーカス。",
    },
    "contributions:commands": {
      purpose: "明示的なコマンドパレットコマンドを追加します。",
      hostOwns: "レジストリ、パレット、ショートカット、結果表示。",
    },
    "contributions:settingsOptions": {
      purpose: "宣言済みプラグイン設定の動的な選択肢を解決します。",
      hostOwns: "フォーム描画、フォールバック入力、値の検証。",
    },
    "contributions:voiceProviders": {
      purpose:
        "ボイスを一覧表示し、読み上げ用のエンコード済み音声を合成します。",
      hostOwns: "再生、速度、先読み、ハイライト、フォールバック。",
    },
    "contributions:contentProviders": {
      purpose: "RSSフィードなどの仮想ブックのセクションを読み込みます。",
      hostOwns: "ライブラリ連携、読書モデル、ナビゲーション、表示。",
    },
    "contributions:readerModes": {
      purpose:
        "文または段落の区切りを限定的に提供します。現在は同梱プラグインのみ。",
      hostOwns: "リーダーの操作、ライフサイクル、描画、ナビゲーション。",
    },
    "contributions:agentTools": {
      purpose: "読書アシスタントが呼び出せる名前空間付きツールを登録します。",
      hostOwns:
        "オーケストレーション、ツールの可視性、承認、トランスクリプトUI。",
    },
    "contributions:agentContextProviders": {
      purpose:
        "現在のユーザーターン向けに範囲を限定した参照ブロックを返します。",
      hostOwns: "プロヴェナンス、切り詰め、プロンプト配置、存続期間。",
    },
    "contributions:agentRetrievalProviders": {
      purpose:
        "検索可能なプラグイン所有ソースを名前空間付きエージェントツールとして公開します。",
      hostOwns: "クエリスキーマ、制限、結果の切り詰め、ツール説明。",
    },
    "contributions:memoryCandidateProviders": {
      purpose: "ターン後に事実、嗜好、洞察、概要の候補を提案します。",
      hostOwns: "スコープ確認、重複排除、採用、永続メモリへの書き込み。",
    },
    "contributions:themes": {
      purpose: "アプリとリーダーの意味的なテーマデータを提供します。",
      hostOwns: "検証、CSS生成、選択、適用。",
    },
    "contributions:fonts": {
      purpose:
        "承認済みフォントのメタデータと同梱フォントアセットを提供します。",
      hostOwns: "ファイル検証、読み込み、選択肢、アクティブ選択。",
    },
    "services:storage": {
      purpose: "プラグインスコープのKVとドキュメントコレクションを使います。",
      hostOwns: "名前空間分離、永続化、スナップショット、変更イベント。",
    },
    "services:secrets": {
      purpose:
        "プラグインスコープのシークレットスロットに認証情報を保存・取得します。",
      hostOwns: "暗号化、非開示、名前空間分離。",
    },
    "services:ui": {
      purpose:
        "ホストのトーストを表示するか、保存・エクスポートフローを開きます。",
      hostOwns: "表示、パス選択、プラットフォーム連携。",
    },
    "services:schedules": {
      purpose: "マニフェストで宣言した定期タスクに処理を結び付けます。",
      hostOwns: "間隔、起動時の追いつき、重複防止、破棄。",
    },
    "services:session": {
      purpose: "現在の読書セッションに関する限定された事実を購読します。",
      hostOwns: "イベントソース、ペイロード制限、購読ライフサイクル。",
    },
    "services:network": {
      purpose: "ネイティブホストクライアント経由でHTTPリクエストを実行します。",
      hostOwns: "権限強制、転送、レスポンスブリッジ。",
    },
    "services:llm": {
      purpose:
        "範囲を限定した一回限りのテキストまたは構造化モデル呼び出しを実行します。",
      hostOwns: "プロバイダー設定、認証情報、スキーマ処理、制限。",
    },
    "services:clipboard": {
      purpose: "システムクリップボードにテキストを書き込みます。",
      hostOwns: "プラットフォーム呼び出しと権限強制。",
    },
    "schemas:views": {
      purpose:
        "Markdown、リスト、フォーム、詳細、範囲を限定したブロックツリーを返します。",
      hostOwns:
        "コンポーネント、HTML安全性、レイアウト、アクセシビリティ、ナビゲーション。",
    },
    "schemas:settings": {
      purpose: "ホスト描画のプラグイン設定フィールドを宣言します。",
      hostOwns: "フォーム動作、検証、ストレージ振り分け、シークレット処理。",
    },
    "schemas:themes": {
      purpose: "意味的なテーマトークンと同梱フォントメタデータを宣言します。",
      hostOwns: "文法検証、生成CSS、読み込み、選択。",
    },
  },
};

const permissionCopy: PluginPermissionPreviewCopy = {
  inputLabel: "manifest.json",
  inputHint: "このページ内でのみ解析されます。アップロードは行いません。",
  previewLabel: "レビュー用プレビュー",
  noAuthority:
    "このマニフェストは意味的な権限も設定付与も要求していません。",
  invalidJson: "有効なJSONオブジェクトを入力してください。",
  issuesTitle: "レビューのメモ",
  permissionsTitle: "ユーザー権限 · 意味的権限",
  settingsTitle: "ユーザー権限 · 正確な設定付与",
  requirementsTitle: "互換性 · 権限ではない",
  declarationsTitle: "運用宣言 · 権限ではない",
  none: "宣言なし",
  schemaVersion: "プライベートデータスキーマ",
  schedules: (count) => `${count}件の定期タスク`,
  themes: (count) => `${count}件のテーマ`,
  fonts: (count) => `${count}件の同梱フォント宣言`,
  unknownPermission: (permission) => `不明な権限: ${permission}`,
  missingField: (field) => `必須フィールドがありません: ${field}`,
  invalidSchemaVersion: "schemaVersionは正の整数でなければなりません。",
  invalidPermissions: "permissionsは配列でなければなりません。",
  invalidSettingsAccess: "settingsAccessはオブジェクトでなければなりません。",
  unknownSettingsOperation: (operation) => `不明な設定操作: ${operation}`,
  invalidSettingsGrant: (operation) =>
    `${operation} 正確なパスまたはsection.*グループを含める必要があります。`,
  sectionGrantWarning: (path) =>
    `${path} 設定セクション全体を付与します。可能な限り正確なパスを使用してください。`,
  permissionDescriptions: {
    "library:read": "本、原文、メタデータ、目次、コレクションを読み取ります。",
    "library:write":
      "ライブラリを変更します。書き込み権限には読み取り権限が含まれます。",
    "reading:read":
      "アクティブなセッション、位置、進捗、読書時間を読み取ります。",
    "reading:write":
      "読書状態を移動・変更します。書き込み権限には読み取り権限が含まれます。",
    "annotations:read": "ハイライトとメモを読み取ります。",
    "annotations:write":
      "注釈を作成、編集、削除します。書き込み権限には読み取り権限が含まれます。",
    "conversations:read": "本とグローバル会話の概要を読み取ります。",
    "reader:modes":
      "ガイド付きリーダーモードを登録します。現在は同梱プラグインのみです。",
    "agent:tools": "読書アシスタントが呼び出せるツールを登録します。",
    "agent:context":
      "1ターンに範囲を限定した信頼されない参照ブロックを追加します。",
    "agent:retrieval": "検索可能なプラグインソースをアシスタントに公開します。",
    "agent:memory": "ホストがレビューする永続メモリ候補を提案します。",
    "ui:themes": "アプリテーマ、リーダーテーマ、同梱フォントを提供します。",
    "service:network": "ホスト経由のネットワークリクエストを実行します。",
    "service:llm":
      "設定済みモデルで範囲を限定した一回限りの呼び出しを実行します。",
    "service:clipboard": "システムクリップボードにテキストを書き込みます。",
  },
  operationLabels: { discover: "検出", read: "読み取り", write: "書き込み" },
  familyLabels: {
    domains: "ドメイン",
    contributions: "コントリビューション",
    services: "サービス",
    schemas: "スキーマ",
  },
};

const sampleManifest = `{
  "id": "research-notes",
  "name": "調査メモ",
  "version": "0.1.0",
  "schemaVersion": 1,
  "requires": {
    "domains": {
      "annotations": "^1.0.0",
      "settings": "^1.0.0"
    },
    "contributions": {
      "commands": "^1.0.0",
      "agentRetrievalProviders": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "network": "^1.0.0"
    },
    "schemas": {
      "settings": "^1.0.0"
    }
  },
  "permissions": [
    "annotations:read",
    "agent:retrieval",
    "service:network"
  ],
  "settingsAccess": {
    "discover": ["appearance.theme"],
    "read": ["appearance.theme"]
  },
  "schedules": [
    {
      "id": "refresh",
      "label": "ソースを更新",
      "everyMinutes": 60
    }
  ],
  "main": "main.js"
}`;

function PluginCapabilitiesPage() {
  return (
    <article className="doc-prose">
      <h1>機能ブラウザー</h1>
      <p className="lead">
        プラグインを設計する前に、公開カタログ全体を検索します。各機能は独立してバージョン管理され、すべての依存関係はマニフェストの{" "}
        マニフェストの<code>requires</code>セクションに記載します。
      </p>

      <PluginCapabilityBrowser copy={capabilityCopy} />

      <h2>カタログの読み方</h2>
      <ul>
        <li>
          <strong>権限</strong>{" "}
          は呼び出し時に必要な権限または正確な設定付与を示します。
        </li>
        <li>
          <strong>なし</strong>{" "}
          は追加のインストール権限がないことを意味し、文書化されていない暗黙の権限を意味しません。
        </li>
        <li>
          <strong>ホストが保持するもの</strong>{" "}
          はプラグインが置き換えたり迂回したりできない境界を示します。
        </li>
        <li>
          各エントリの横に表示されるバージョンは、ホストの正規機能カタログから直接取得されます。
        </li>
      </ul>
      <p>
        <code>readerModes</code>{" "}
        は、特権的なリーダー契約が確定するまで同梱プラグインに限定されます。マニフェストが指定できるのはカタログにある機能だけで、ホストはアクター、権限、バージョン、ライフサイクル段階に基づいて可視ランタイムビューをフィルターします。
      </p>

      <h2>権限プレビュー</h2>
      <p>
        マニフェストを貼り付けて、ユーザー権限を互換性および運用宣言から分離します。インストール同意の意味を反映しますが、リポジトリ検証を置き換えたり、プラグインが有効化できることを証明したりするものではありません。
      </p>

      <PluginPermissionPreview
        copy={permissionCopy}
        sampleManifest={sampleManifest}
      />

      <h2>インストールダイアログが実際に付与するもの</h2>
      <p>
        意味的な<code>permissions</code>と正確な<code>settingsAccess</code>の
        エントリが権限を付与します。正式な同意ダイアログは両方をわかりやすい言葉で表示します。機能要件、スケジュール、スキーマバージョン、テーマ、フォントはレビューに役立つ情報ですが、権限として密かに扱われることはありません。
      </p>
      <p>
        このプレビューは意図的にローカルかつステートレスです。次の開発者ツールでは、同じランタイムカタログに基づくアプリ内アクタービューとライフサイクルインスペクターを提供し、更新時の権限差分と、利用できない機能の正確な理由を表示します。
      </p>
    </article>
  );
}
