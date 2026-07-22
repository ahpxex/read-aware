import { createFileRoute } from "@tanstack/react-router";
import { useLatestRelease } from "../../hooks/useLatestRelease";
import { RELEASES_URL } from "../../lib/releases";

export const Route = createFileRoute("/docs/install")({
  head: () => ({
    meta: [
      { title: "Download & install — ReadAware Docs" },
      {
        name: "description",
        content:
          "Install ReadAware on macOS, Windows, Linux, Android, or iOS, including first-launch notes for unsigned builds.",
      },
    ],
  }),
  component: InstallPage,
});

function InstallPage() {
  const release = useLatestRelease();

  return (
    <article className="doc-prose">
      <h1>Download &amp; install</h1>
      <p className="lead">
        ReadAware is free. Every release ships installers for macOS, Windows,
        Linux, and Android{release.tag ? `; the current release is ${release.tag}` : ""}.
        All versions, past and present, live on the{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          GitHub releases page
        </a>
        .
      </p>

      <h2>Downloads</h2>
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
              {download.id === release.platform ? " (your platform)" : ""} —{" "}
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
        Download the <code>.dmg</code> for your Mac — Apple Silicon for M-series
        machines, Intel for older ones — open it, and drag ReadAware into
        Applications.
      </p>
      <p>
        Desktop builds are not notarized with Apple yet, so the first launch is
        blocked with a warning that the app could not be verified. To open it
        anyway:
      </p>
      <ol>
        <li>Try to open ReadAware once and dismiss the warning.</li>
        <li>
          Open System Settings → Privacy &amp; Security, scroll down to the
          notice that ReadAware was blocked, and choose <strong>Open
          Anyway</strong>.
        </li>
      </ol>
      <p>
        Alternatively, clear the quarantine flag once from Terminal and launch
        normally:
      </p>
      <pre>
        <code>xattr -cr /Applications/ReadAware.app</code>
      </pre>

      <h2>Windows</h2>
      <p>
        Download and run the installer (<code>-setup.exe</code>). Because the
        build is not code-signed yet, Microsoft Defender SmartScreen may
        interpose; choose <strong>More info</strong>, then{" "}
        <strong>Run anyway</strong>.
      </p>
      <p>
        An <code>.msi</code> package is available for managed installs, and a
        portable <code>.zip</code> runs without installing anything — unpack it
        and start <code>ReadAware.exe</code>.
      </p>

      <h2>Linux</h2>
      <p>
        The <code>.AppImage</code> runs on most distributions without
        installation — make it executable and start it:
      </p>
      <pre>
        <code>{`chmod +x ReadAware-*-linux-x64.AppImage
./ReadAware-*-linux-x64.AppImage`}</code>
      </pre>
      <p>
        AppImages need FUSE; on distributions without it (some minimal or very
        recent ones), install your distribution's <code>libfuse2</code> package
        first. Native packages are also available:
      </p>
      <pre>
        <code>{`# Debian / Ubuntu
sudo apt install ./ReadAware-*-linux-x64.deb

# Fedora / RHEL
sudo dnf install ./ReadAware-*-linux-x64.rpm`}</code>
      </pre>

      <h2>Android</h2>
      <p>
        Download the <code>.apk</code> (arm64) on your device and open it. The
        APK is signed; Android will still ask you to allow installs from your
        browser or file manager the first time, since it does not come from a
        store.
      </p>

      <h2>iOS</h2>
      <p>
        ReadAware is not on the App Store yet. Each release does include an
        unsigned <code>.ipa</code> on the{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          releases page
        </a>{" "}
        for sideloading: tools like AltStore, SideStore, or Sideloadly re-sign
        it with your own Apple ID and install it on your device. This path is
        for people already comfortable with sideloading; a store release will
        come later.
      </p>

      <h2>Staying up to date</h2>
      <p>
        The desktop app updates itself: it checks for new releases, downloads
        the update in the background, and applies it on restart. Update
        packages are cryptographically signed and verified against a key built
        into the app, independent of OS code signing. On Android and iOS,
        install new versions manually from the releases page for now.
      </p>
    </article>
  );
}
