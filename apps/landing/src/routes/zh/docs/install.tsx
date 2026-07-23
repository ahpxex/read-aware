import { createFileRoute } from "@tanstack/react-router";
import { useLatestRelease } from "../../../hooks/useLatestRelease";
import { RELEASES_URL } from "../../../lib/releases";

export const Route = createFileRoute("/zh/docs/install")({
  head: () => ({
    meta: [
      { title: "下载安装 — ReadAware 文档" },
      {
        name: "description",
        content:
          "在 macOS、Windows、Linux、Android 或 iOS 上安装 ReadAware，包括未签名构建首次启动的注意事项。",
      },
    ],
  }),
  component: InstallPage,
});

function InstallPage() {
  const release = useLatestRelease();

  return (
    <article className="doc-prose">
      <h1>下载安装</h1>
      <p className="lead">
        ReadAware 是免费的。每个版本都会发布 macOS、Windows、Linux 和 Android
        的安装包{release.tag ? `；当前版本为 ${release.tag}` : ""}。所有版本，无论新旧，都在{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          GitHub releases 页面
        </a>
        。
      </p>

      <h2>下载</h2>
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
        下载与你的 Mac 对应的 <code>.dmg</code>——M 系列芯片选 Apple
        Silicon，较早的机型选 Intel——打开后把 ReadAware 拖入“应用程序”。
      </p>
      <p>
        桌面构建尚未经过 Apple
        公证，因此首次启动会被拦下，提示无法验证这款应用。要继续打开：
      </p>
      <ol>
        <li>先尝试打开一次 ReadAware，并关闭弹出的警告。</li>
        <li>
          打开“系统设置 → 隐私与安全性”，向下滚动到 ReadAware
          已被阻止的提示，选择<strong>仍要打开</strong>。
        </li>
      </ol>
      <p>
        也可以在终端里清除一次隔离标记，之后即可正常启动：
      </p>
      <pre>
        <code>xattr -cr /Applications/ReadAware.app</code>
      </pre>

      <h2>Windows</h2>
      <p>
        下载并运行安装程序（<code>-setup.exe</code>）。由于构建尚未做代码签名，Microsoft
        Defender SmartScreen 可能会拦截；选择<strong>更多信息</strong>，再点
        <strong>仍要运行</strong>。
      </p>
      <p>
        另有 <code>.msi</code> 包可用于受管安装；便携版 <code>.zip</code>{" "}
        无需安装任何东西——解压后直接运行 <code>ReadAware.exe</code>。
      </p>

      <h2>Linux</h2>
      <p>
        <code>.AppImage</code>{" "}
        在大多数发行版上无需安装即可运行——赋予可执行权限后启动：
      </p>
      <pre>
        <code>{`chmod +x ReadAware-*-linux-x64.AppImage
./ReadAware-*-linux-x64.AppImage`}</code>
      </pre>
      <p>
        AppImage 依赖
        FUSE；如果发行版没有预装（部分极简或非常新的发行版），请先安装发行版的{" "}
        <code>libfuse2</code> 软件包。也提供原生软件包：
      </p>
      <pre>
        <code>{`# Debian / Ubuntu
sudo apt install ./ReadAware-*-linux-x64.deb

# Fedora / RHEL
sudo dnf install ./ReadAware-*-linux-x64.rpm`}</code>
      </pre>

      <h2>Android</h2>
      <p>
        在设备上下载 <code>.apk</code>（arm64）并打开。APK
        已签名；但因为它不是来自应用商店，首次安装时 Android
        仍会要求你允许来自浏览器或文件管理器的安装。
      </p>

      <h2>iOS</h2>
      <p>
        ReadAware 尚未上架 App Store。不过每个版本都会在{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          releases 页面
        </a>
        提供未签名的 <code>.ipa</code> 用于侧载：AltStore、SideStore、Sideloadly
        等工具会用你自己的 Apple ID
        重新签名并安装到设备上。这条路径面向已经熟悉侧载的用户；商店版本会在之后到来。
      </p>

      <h2>保持更新</h2>
      <p>
        桌面应用会自行更新：检查新版本、在后台下载更新，并在重启时应用。更新包经过加密签名，并用内置于应用中的密钥校验，与操作系统的代码签名相互独立。在
        Android 和 iOS 上，目前请从 releases 页面手动安装新版本。
      </p>
    </article>
  );
}
