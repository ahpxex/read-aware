import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/de/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "Plugin veröffentlichen — ReadAware-Dokumentation" },
      {
        name: "description",
        content:
          "Ein ReadAware-Plugin für das öffentliche Marktplatz-Repository vorbereiten, validieren, prüfen und einreichen.",
      },
    ],
  }),
  component: VeröffentlichenPage,
});

function VeröffentlichenPage() {
  return (
    <article className="doc-prose">
      <h1>Plugin veröffentlichen</h1>
      <p className="lead">
        Marktplatzpakete liegen im öffentlichen{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
        readaware-plugins-Repository
        </a>{" "}
        und werden nach einer Prüfung aufgenommen. Der aktuelle Katalog ist offiziell; dieser
        Prozess ist auch der Vertrag für künftige externe Einreichungen.
      </p>

      <h2>Ein prüfbares Paket vorbereiten</h2>
      <p>
        TypeScript wird empfohlen. Lege <code>src/</code> neben das gebaute,
        eigenständige <code>main.js</code>, damit Prüfer Quelltext und Artefakt
        vergleichen können. Committe jede Laufzeitressource. Lade keinen entfernten Code, verstecke
        Verhalten nicht in generierten Blobs und verlasse dich nicht auf Dateien außerhalb des Pakets.
      </p>
      <pre><code>{`plugins/my-plugin/
  manifest.json
  main.js
  package.json
  tsconfig.json
  src/main.ts
  assets/…`}</code></pre>

      <h2>Repository-Prüfungen ausführen</h2>
      <pre><code>{`bun run build
bun run typecheck
bun test
bun run validate`}</code></pre>
      <p>
        Die Validierung prüft die Übereinstimmung von Register und Manifest, IDs, Versionen,
        Fähigkeitsanforderungen, Berechtigungen, deklarierte Dateien und Paket-
        Struktur. Diese Prüfungen sind notwendig, aber nicht ausreichend: Führe den gebauten
        Ordner vor der Einreichung in ReadAware Desktop aus.
      </p>

      <h2>Einreichen</h2>
      <ol>
        <li>Forke das öffentliche Repository.</li>
        <li>Kopiere die Vorlage nach <code>plugins/&lt;plugin-id&gt;/</code> und halte den Ordnernamen identisch mit der Manifest-ID.</li>
        <li>Füge das Paket und alle erforderlichen Laufzeitressourcen hinzu.</li>
        <li>Füge den passenden, nach ID sortierten Eintrag zu <code>registry.json</code> hinzu.</li>
        <li>Führe alle vier Prüfungen im Stammverzeichnis aus und teste die lokale Installation aus dem gebauten Ordner.</li>
        <li>Eröffne einen Pull Request, der Verhalten, private Daten, externe Dienste sowie den Grund für jede Berechtigung und Einstellungsfreigabe beschreibt.</li>
      </ol>

      <h2>Prüfliste</h2>
      <ul>
        <li>Die Funktion verwendet die jeweils engsten vorhandenen Domänen-, Beitrags- und Dienstfähigkeiten.</li>
        <li><code>requires</code> benennt jeden verwendeten Vertrag mit einem vertretbaren Semver-Bereich.</li>
        <li>Berechtigungen und <code>settingsAccess</code> stimmen mit den tatsächlichen Laufzeitaufrufen überein und enthalten keine spekulative Autorität.</li>
        <li><code>activate()</code> registriert Verhalten, führt aber keine geschäftlichen oder externen Nebenwirkungen aus.</li>
        <li>Private Plugin-Daten haben ein stabiles Schema; jeder Versionsübergang besitzt eine getestete Migration.</li>
        <li>Netzwerkendpunkte, LLM-Nutzung, Zugangsdaten, Zeitpläne und Datenaufbewahrung werden verständlich erklärt.</li>
        <li>Vom Host gerenderte Ansichten funktionieren mit Tastaturnavigation, langen Texten, leeren Daten sowie hellen und dunklen Designs.</li>
        <li>Der Quelltext ist lesbar, die Ausgabe reproduzierbar; es gibt keine Analyse, Nachverfolgung, Verschleierung oder das Laden entfernten Codes.</li>
      </ul>
      <p>
        Die <Link to="/de/docs/plugins/capabilities">Berechtigungs-Vorschau</Link> ist eine
        nützliche Vorprüfung. Repository-Validierung und menschliche Prüfung bleiben die
        maßgeblichen Prüfungen.
      </p>

      <h2>Updates und Datenmigration</h2>
      <p>
        Erhöhe die Paketversion sowohl in <code>manifest.json</code> als auch in{" "}
        <code>registry.json</code>. Erhöhe <code>schemaVersion</code> nur, wenn
        sich die Form privater KV-Daten oder Dokumente ändert, und liefere die passende{" "}
        <code>migrate()</code> im selben Kandidaten aus.
      </p>
      <p>
        Teste Update und bewusstes Downgrade mit realistischen Daten. ReadAware
        stellt den Kandidaten bereit und prüft ihn, erstellt Snapshots von Plugin-Dateien und
        Daten, hält die alte Laufzeit für die Migration an und aktiviert erst nach
        Erfolg. Ein fehlgeschlagenes Update muss das vorherige Paket und die Daten
        nutzbar hinterlassen.
      </p>

      <h2>Berechtigungsänderungen</h2>
      <p>
        Behandle neue Autorität als Produktänderung, nicht als Manifest-Pflege.
        Erkläre, warum die bisherigen Berechtigungen nicht ausreichen, welche Nutzerdaten
        oder externe Operation erreichbar wird und was geschieht, wenn der
        Nutzer ablehnt. Entferne Berechtigungen, die der Code nicht mehr verwendet.
      </p>

      <h2>Vertrauen bei der Verteilung heute</h2>
      <p>
        Worker-Isolierung und Durchsetzung von Fähigkeiten reduzieren Überschreitungen, aber
        Installation bleibt eine Vertrauensentscheidung. Vor einem breiten Drittanbieter-
        Marktplatz braucht ReadAware weiterhin Herausgeberidentität, deterministisches
        Paketierung sowie Signatur- und Integritätsprüfung, Prüfherkunft,
        Widerruf, Prüfung von Berechtigungsänderungen und einen Sicherheitsreaktionsweg.
      </p>
      <p>
        Bis diese Kontrollen verfügbar sind, ist ein zusammengeführter Repository-Eintrag ein Prüfbeleg,
        keine mathematische Garantie, dass beliebiger feindlicher Code sicher ist.
      </p>

      <h2>Vor dem Eröffnen des Pull Requests</h2>
      <p>
        Lies <Link to="/de/docs/plugins/develop">Plugin erstellen</Link> erneut,
        vergleiche das endgültige Manifest in den{" "}
        <Link to="/de/docs/plugins/capabilities">Fähigkeitswerkzeugen</Link> und
        bestätige, dass das Paket dem aktuellen{" "}
        <Link to="/de/docs/plugins/api">API-Vertrag</Link> folgt und nicht einem
        älteren Beispiel mit <code>shelf</code> oder <code>appearance</code>.
      </p>
    </article>
  );
}
