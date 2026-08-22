import { Link, createFileRoute } from "@tanstack/react-router";
import { REPO_URL } from "../../../lib/releases";
import { DISCORD_URL } from "../../../lib/site";

export const Route = createFileRoute("/de/docs/")({
  head: () => ({
    meta: [
      { title: "Dokumentation — ReadAware Dokumentation" },
      {
        name: "description",
        content:
          "Wie du ReadAware installierst, mit dem Lesen beginnst und die App durch Plugins erweiterst.",
      },
    ],
  }),
  component: DocsOverview,
});

function DocsOverview() {
  return (
    <article className="doc-prose">
      <h1>Dokumentation</h1>
      <p className="lead">
        ReadAware ist eine KI-native Lese-App: ein Reader für EPUB, MOBI, AZW3,
        FB2, CBZ, CBR, TXT, HTML und PDF, der über deine Bücher, Markierungen
        und Gespräche hinweg ein Gedächtnis aufbaut. Sie ist kostenlos,
        local-first und läuft mit deinem eigenen KI-Schlüssel.
      </p>

      <h2>Hier beginnen</h2>
      <ul>
        <li>
          <Link to="/de/docs/install">Download &amp; Installation</Link> —
          Installationsprogramme für macOS, Windows, Linux und Android, und was
          zu tun ist, wenn dein Betriebssystem vor einer unsignierten App warnt.
        </li>
        <li>
          <Link to="/de/docs/getting-started">Erste Schritte</Link> — Bücher
          importieren, lesen und annotieren, einen KI-Anbieter verbinden und
          verstehen, wo deine Daten liegen.
        </li>
      </ul>

      <h2>Die App erweitern</h2>
      <ul>
        <li>
          <Link to="/de/docs/plugins">Plugin-System</Link> — was Plugins leisten
          können und wie das Vertrauensmodell funktioniert.
        </li>
        <li>
          <Link to="/de/docs/plugins/api">API-Referenz</Link> — der komplette
          Autorenvertrag: Manifest, Lebenszyklus, Berechtigungen, Contributions
          und Views.
        </li>
        <li>
          <Link to="/de/docs/plugins/publishing">Veröffentlichen</Link> — wie du
          dein Plugin in den In-App-Marktplatz bringst.
        </li>
      </ul>

      <h2>Weitere Ressourcen</h2>
      <p>
        Die App wird offen entwickelt auf{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . Bei Fragen, Fehlerberichten oder um zu zeigen, was du gebaut hast,
        tritt dem{" "}
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Discord
        </a>{" "}
        bei oder eröffne ein Issue.
      </p>
    </article>
  );
}
