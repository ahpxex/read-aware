import { createFileRoute } from "@tanstack/react-router";
import { useLatestRelease } from "../../../hooks/useLatestRelease";
import { RELEASES_URL } from "../../../lib/releases";

export const Route = createFileRoute("/ja/docs/install")({
  head: () => ({
    meta: [
      { title: "ダウンロードとインストール — ReadAware ドキュメント" },
      {
        name: "description",
        content:
          "macOS、Windows、Linux、Android、iOSへのReadAwareのインストール手順と、未署名ビルドを初回起動するときの注意点。",
      },
    ],
  }),
  component: InstallPage,
});

function InstallPage() {
  const release = useLatestRelease();

  return (
    <article className="doc-prose">
      <h1>ダウンロードとインストール</h1>
      <p className="lead">
        ReadAwareは無料です。各リリースにはmacOS、Windows、Linux、Android向けのインストーラーが含まれます
        {release.tag ? `（現在のリリースは${release.tag}です）` : ""}
        。過去のものも含むすべてのバージョンは
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          GitHubのリリースページ
        </a>
        にあります。
      </p>

      <h2>ダウンロード</h2>
      <ul>
        {release.downloads.map((download) => {
          if (download.comingSoon) return null;
          const links = [
            ...(download.primary ? [download.primary] : []),
            ...download.extras,
          ];
          return (
            <li key={download.id}>
              <strong>{download.name}</strong>
              {download.id === release.platform ? "（お使いのプラットフォーム）" : ""} —{" "}
              {links.map((link, index) => (
                <span key={link.url}>
                  {index > 0 ? " · " : ""}
                  <a href={link.url}>{link.label}</a>
                </span>
              ))}
            </li>
          );
        })}
      </ul>

      <h2>macOS</h2>
      <p>
        お使いのMacに合った<code>.dmg</code>
        をダウンロードします。Mシリーズの機種はApple
        Silicon版、それ以前の機種はIntel版です。開いたら、ReadAwareをアプリケーションフォルダにドラッグしてください。
      </p>
      <p>
        デスクトップビルドはまだAppleの公証を受けていないため、初回起動時には「検証できない」という警告でブロックされます。それでも開くには次のようにします。
      </p>
      <ol>
        <li>まずReadAwareを一度開こうとして、表示された警告を閉じます。</li>
        <li>
          「システム設定 →
          プライバシーとセキュリティ」を開き、下にスクロールしてReadAwareがブロックされた旨の表示を見つけ、
          <strong>このまま開く</strong>を選びます。
        </li>
      </ol>
      <p>
        あるいは、ターミナルで一度quarantine属性を外してから、通常どおり起動することもできます。
      </p>
      <pre>
        <code>xattr -cr /Applications/ReadAware.app</code>
      </pre>

      <h2>Windows</h2>
      <p>
        インストーラー（<code>-setup.exe</code>
        ）をダウンロードして実行します。ビルドはまだコード署名されていないため、Microsoft
        Defender SmartScreenが警告を表示することがあります。その場合は
        <strong>詳細情報</strong>、続けて<strong>実行</strong>を選んでください。
      </p>
      <p>
        管理されたインストール向けに<code>.msi</code>
        パッケージも用意しています。ポータブル版の<code>.zip</code>
        は何もインストールせずに使えます。展開して<code>ReadAware.exe</code>
        を起動してください。
      </p>

      <h2>Linux</h2>
      <p>
        <code>.AppImage</code>
        はほとんどのディストリビューションでインストール不要で動きます。実行権限を付けて起動してください。
      </p>
      <pre>
        <code>{`chmod +x ReadAware-*-linux-x64.AppImage
./ReadAware-*-linux-x64.AppImage`}</code>
      </pre>
      <p>
        AppImageの実行にはFUSEが必要です。FUSEがないディストリビューション（ミニマル構成やごく新しいものの一部）では、先にディストリビューションの
        <code>libfuse2</code>
        パッケージをインストールしてください。ネイティブパッケージも用意しています。
      </p>
      <pre>
        <code>{`# Debian / Ubuntu
sudo apt install ./ReadAware-*-linux-x64.deb

# Fedora / RHEL
sudo dnf install ./ReadAware-*-linux-x64.rpm`}</code>
      </pre>

      <h2>Android</h2>
      <p>
        端末で<code>.apk</code>
        （arm64）をダウンロードして開きます。APKは署名済みですが、ストア経由ではないため、初回はブラウザやファイルマネージャーからのインストールを許可するよう求められます。
      </p>

      <h2>iOS</h2>
      <p>
        ReadAwareはまだApp
        Storeにはありません。ただし各リリースには、サイドロード用の未署名<code>.ipa</code>が
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          リリースページ
        </a>
        に含まれています。AltStore、SideStore、Sideloadlyなどのツールで自分のApple
        IDを使って再署名し、端末にインストールします。この方法はサイドロードに慣れている方向けです。ストアでの公開は今後の予定です。
      </p>

      <h2>最新の状態に保つ</h2>
      <p>
        デスクトップアプリは自動で更新されます。新しいリリースを確認し、バックグラウンドでダウンロードして、再起動時に適用します。更新パッケージは暗号学的に署名されており、OSのコード署名とは独立に、アプリに組み込まれた鍵で検証されます。AndroidとiOSでは、当面はリリースページから手動で新しいバージョンをインストールしてください。
      </p>
    </article>
  );
}
