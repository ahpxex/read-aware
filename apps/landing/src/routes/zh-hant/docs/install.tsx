import { createFileRoute } from "@tanstack/react-router";
import { useLatestRelease } from "../../../hooks/useLatestRelease";
import { RELEASES_URL } from "../../../lib/releases";

export const Route = createFileRoute("/zh-hant/docs/install")({
  head: () => ({
    meta: [
      { title: "下載安裝 — ReadAware 文件" },
      {
        name: "description",
        content:
          "在 macOS、Windows、Linux、Android 或 iOS 上安裝 ReadAware，包括未簽署組建首次啟動的注意事項。",
      },
    ],
  }),
  component: InstallPage,
});

function InstallPage() {
  const release = useLatestRelease();

  return (
    <article className="doc-prose">
      <h1>下載安裝</h1>
      <p className="lead">
        ReadAware 是免費的。每個版本都會發佈 macOS、Windows、Linux 和 Android
        的安裝套件{release.tag ? `；目前版本為 ${release.tag}` : ""}。所有版本，無論新舊，都在{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          GitHub releases 頁面
        </a>
        。
      </p>

      <h2>下載</h2>
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
              {download.id === release.platform ? "（你的平台）" : ""} —{" "}
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
        下載與你的 Mac 對應的 <code>.dmg</code>——M 系列晶片選 Apple
        Silicon，較早的機型選 Intel——開啟後把 ReadAware 拖入「應用程式」。
      </p>
      <p>
        桌面組建尚未經過 Apple
        公證，因此首次啟動會被攔下，提示無法驗證這款應用程式。要繼續開啟：
      </p>
      <ol>
        <li>先嘗試開啟一次 ReadAware，並關閉彈出的警告。</li>
        <li>
          開啟「系統設定 → 隱私權與安全性」，向下捲動到 ReadAware
          已被阻止的提示，選擇<strong>仍要開啟</strong>。
        </li>
      </ol>
      <p>
        也可以在終端機裡清除一次隔離標記，之後即可正常啟動：
      </p>
      <pre>
        <code>xattr -cr /Applications/ReadAware.app</code>
      </pre>

      <h2>Windows</h2>
      <p>
        下載並執行安裝程式（<code>-setup.exe</code>）。由於組建尚未做程式碼簽署，Microsoft
        Defender SmartScreen 可能會攔截；選擇<strong>更多資訊</strong>，再點
        <strong>仍要執行</strong>。
      </p>
      <p>
        另有 <code>.msi</code> 套件可用於受管理的安裝；可攜版 <code>.zip</code>{" "}
        無需安裝任何東西——解壓縮後直接執行 <code>ReadAware.exe</code>。
      </p>

      <h2>Linux</h2>
      <p>
        <code>.AppImage</code>{" "}
        在大多數發行版上無需安裝即可執行——賦予可執行權限後啟動：
      </p>
      <pre>
        <code>{`chmod +x ReadAware-*-linux-x64.AppImage
./ReadAware-*-linux-x64.AppImage`}</code>
      </pre>
      <p>
        AppImage 依賴
        FUSE；如果發行版沒有預先安裝（部分極簡或非常新的發行版），請先安裝發行版的{" "}
        <code>libfuse2</code> 套件。也提供原生套件：
      </p>
      <pre>
        <code>{`# Debian / Ubuntu
sudo apt install ./ReadAware-*-linux-x64.deb

# Fedora / RHEL
sudo dnf install ./ReadAware-*-linux-x64.rpm`}</code>
      </pre>

      <h2>Android</h2>
      <p>
        在裝置上下載 <code>.apk</code>（arm64）並開啟。APK
        已簽署；但因為它不是來自應用程式商店，首次安裝時 Android
        仍會要求你允許來自瀏覽器或檔案管理器的安裝。
      </p>

      <h2>iOS</h2>
      <p>
        ReadAware 尚未上架 App Store。不過每個版本都會在{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          releases 頁面
        </a>
        提供未簽署的 <code>.ipa</code> 用於側載：AltStore、SideStore、Sideloadly
        等工具會用你自己的 Apple ID
        重新簽署並安裝到裝置上。這條路徑面向已經熟悉側載的使用者；商店版本會在之後到來。
      </p>

      <h2>保持更新</h2>
      <p>
        桌面應用程式會自行更新：檢查新版本、在背景下載更新，並在重新啟動時套用。更新套件經過加密簽署，並用內建於應用程式中的金鑰校驗，與作業系統的程式碼簽署相互獨立。在
        Android 和 iOS 上，目前請從 releases 頁面手動安裝新版本。
      </p>
      <p>
        更新落地後，一個小視窗會介紹這次更新了什麼——更新日誌以你的語言直接在應用程式內展示。關掉它對這個版本就是永久關閉；也可以在「設定
        → 一般」裡完全關掉這個視窗。
      </p>
    </article>
  );
}
