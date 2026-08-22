import { createFileRoute } from "@tanstack/react-router";
import { useLatestRelease } from "../../../hooks/useLatestRelease";
import { RELEASES_URL } from "../../../lib/releases";

export const Route = createFileRoute("/de/docs/install")({
  head: () => ({
    meta: [
      { title: "Download & Installation — ReadAware Docs" },
      {
        name: "description",
        content:
          "ReadAware auf macOS, Windows, Linux, Android oder iOS installieren, einschließlich Hinweisen zum ersten Start unsignierter Builds.",
      },
    ],
  }),
  component: InstallPage,
});

function InstallPage() {
  const release = useLatestRelease();

  return (
    <article className="doc-prose">
      <h1>Download &amp; Installation</h1>
      <p className="lead">
        ReadAware ist kostenlos. Jede Version bietet Installationsprogramme für
        macOS, Windows, Linux und Android
        {release.tag ? `; die aktuelle Version ist ${release.tag}` : ""}. Alle
        Versionen, alte wie neue, findest du auf der{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          GitHub-Releases-Seite
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
              {download.id === release.platform ? " (deine Plattform)" : ""} —{" "}
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
        Lade die <code>.dmg</code> für deinen Mac herunter — Apple Silicon für
        Macs der M-Serie, Intel für ältere Modelle — öffne sie und zieh
        ReadAware in den Programme-Ordner.
      </p>
      <p>
        Desktop-Builds sind noch nicht von Apple notarisiert, deshalb wird der
        erste Start mit einer Warnung blockiert, dass die App nicht verifiziert
        werden konnte. Um sie trotzdem zu öffnen:
      </p>
      <ol>
        <li>
          Versuche einmal, ReadAware zu öffnen, und schließe die Warnung.
        </li>
        <li>
          Öffne Systemeinstellungen → Datenschutz &amp; Sicherheit, scrolle
          nach unten zum Hinweis, dass ReadAware blockiert wurde, und wähle{" "}
          <strong>Dennoch öffnen</strong>.
        </li>
      </ol>
      <p>
        Alternativ entferne das Quarantäne-Flag einmalig im Terminal und starte
        die App ganz normal:
      </p>
      <pre>
        <code>xattr -cr /Applications/ReadAware.app</code>
      </pre>

      <h2>Windows</h2>
      <p>
        Lade das Installationsprogramm (<code>-setup.exe</code>) herunter und
        führe es aus. Da der Build noch nicht code-signiert ist, kann sich
        Microsoft Defender SmartScreen dazwischenschalten; wähle{" "}
        <strong>Weitere Informationen</strong>, dann{" "}
        <strong>Trotzdem ausführen</strong>.
      </p>
      <p>
        Ein <code>.msi</code>-Paket ist für verwaltete Installationen verfügbar,
        und eine portable <code>.zip</code> läuft ohne Installation — entpacke
        sie und starte <code>ReadAware.exe</code>.
      </p>

      <h2>Linux</h2>
      <p>
        Das <code>.AppImage</code> läuft auf den meisten Distributionen ohne
        Installation — mach es ausführbar und starte es:
      </p>
      <pre>
        <code>{`chmod +x ReadAware-*-linux-x64.AppImage
./ReadAware-*-linux-x64.AppImage`}</code>
      </pre>
      <p>
        AppImages benötigen FUSE; auf Distributionen, die es nicht mitbringen
        (einige schlanke oder sehr neue), installiere zuerst das{" "}
        <code>libfuse2</code>-Paket deiner Distribution. Native Pakete sind
        ebenfalls verfügbar:
      </p>
      <pre>
        <code>{`# Debian / Ubuntu
sudo apt install ./ReadAware-*-linux-x64.deb

# Fedora / RHEL
sudo dnf install ./ReadAware-*-linux-x64.rpm`}</code>
      </pre>

      <h2>Android</h2>
      <p>
        Lade die <code>.apk</code> (arm64) auf dein Gerät herunter und öffne
        sie. Die APK ist signiert; Android fragt dich beim ersten Mal trotzdem,
        ob du Installationen aus deinem Browser oder Dateimanager erlauben
        willst, da sie nicht aus einem Store kommt.
      </p>

      <h2>iOS</h2>
      <p>
        ReadAware ist noch nicht im App Store. Jede Version enthält jedoch eine
        unsignierte <code>.ipa</code> auf der{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          Releases-Seite
        </a>{" "}
        zum Sideloading: Tools wie AltStore, SideStore oder Sideloadly signieren
        sie mit deiner eigenen Apple-ID neu und installieren sie auf deinem
        Gerät. Dieser Weg ist für Leute gedacht, die bereits mit Sideloading
        vertraut sind; eine Store-Veröffentlichung kommt später.
      </p>

      <h2>Aktuell bleiben</h2>
      <p>
        Die Desktop-App aktualisiert sich selbst: Sie prüft auf neue Versionen,
        lädt das Update im Hintergrund herunter und wendet es beim Neustart an.
        Update-Pakete sind kryptografisch signiert und werden gegen einen in die
        App eingebauten Schlüssel geprüft, unabhängig von der OS-Code-Signierung.
        Auf Android und iOS installierst du vorerst neue Versionen manuell von
        der Releases-Seite.
      </p>
      <p>
        Wenn ein Update eintrifft, zeigt dir ein kleiner Dialog, was sich
        geändert hat — die Release Notes in deiner Sprache, direkt in der App.
        Geschlossen gilt er dauerhaft für diese Version, und unter Einstellungen
        → Allgemein lässt er sich ganz deaktivieren.
      </p>
    </article>
  );
}
