import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/de/docs/plugins/develop")({
  head: () => ({
    meta: [
      { title: "Plugin erstellen — ReadAware-Dokumentation" },
      {
        name: "description",
        content:
          "Ein ReadAware-Plugin mit der öffentlichen TypeScript-Vorlage erstellen, validieren, installieren, migrieren und testen.",
      },
    ],
  }),
  component: DevelopPluginPage,
});

function DevelopPluginPage() {
  return (
    <article className="doc-prose">
      <h1>Plugin erstellen</h1>
      <p className="lead">
        Beginne mit der öffentlichen TypeScript-Vorlage, erkläre die kleinstmögliche
        Fähigkeitsmenge und führe das gebaute Paket in der ReadAware-Desktop-App aus.
        Der Host besitzt Lebenszyklus, Berechtigungen, Darstellung und Rollback;
        dein Plugin besitzt sein Verhalten und seine privaten Daten.
      </p>

      <h2>Voraussetzungen</h2>
      <ul>
        <li>ReadAware Desktop mit Zugriff auf Einstellungen → Plugins.</li>
        <li><a href="https://bun.sh" target="_blank" rel="noopener noreferrer">Bun</a> für Repository-Skripte.</li>
        <li>Ein Checkout oder Fork des{" "}
          <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">readaware-plugins-Repository</a>.
        </li>
      </ul>

      <h2>Paket erstellen</h2>
      <ol>
        <li>Kopiere <code>template/</code> nach <code>plugins/&lt;your-plugin-id&gt;/</code>.</li>
        <li>Halte Ordnername, Manifest-<code>id</code> und Laufzeitnamensraum identisch.</li>
        <li>Bearbeite <code>manifest.json</code> und <code>src/main.ts</code>.</li>
        <li>Lösche nicht verwendete Vorlagenbeiträge und entferne ihre Berechtigungen.</li>
        <li>Baue die eigenständige <code>main.js</code>, die ReadAware lädt.</li>
      </ol>
      <pre><code>{`bun run build
bun run typecheck
bun test
bun run validate`}</code></pre>

      <h2>Manifest vor der Implementierung entwerfen</h2>
      <p>Prüfe das Manifest in dieser Reihenfolge:</p>
      <ol>
        <li><strong>Identität</strong> — stabile ID, Name, Paketversion, Autor und Mindestversion der App.</li>
        <li><strong>Daten</strong> — positive Ganzzahl <code>schemaVersion</code> und Migrationspfad.</li>
        <li><strong>Kompatibilität</strong> — ein Semver-Bereich in <code>requires</code> für jede verwendete API und jedes Schema.</li>
        <li><strong>Berechtigung</strong> — semantische <code>permissions</code> und genaue <code>settingsAccess</code>-Freigaben.</li>
        <li><strong>Deklarationen</strong> — Einstellungen, Zeitpläne, Designs, Schriften und Einstiegsmodul.</li>
      </ol>
      <p>
        Verwende den <Link to="/de/docs/plugins/capabilities">Fähigkeitsbrowser und die Berechtigungs-Vorschau</Link>{" "}
        vor der Installation. Anforderungen sind Kompatibilitätsaussagen, keine Nutzerberechtigungen; auch berechtigungsfreie Fähigkeiten gehören in{" "}
        <code>requires</code>, wenn dein Plugin von ihrem Vertrag abhängt.
      </p>

      <h2>Richtige Fähigkeit auswählen</h2>
      <ol>
        <li>Verwende eine <strong>Domäne</strong> für Zustand oder Verhalten, das ReadAware besitzt.</li>
        <li>Verwende einen <strong>Beitrag</strong>, um eine Auswahl, Aktion oder einen Anbieter bereitzustellen.</li>
        <li>Verwende einen <strong>Dienst</strong> für eine begrenzte Host-Operation.</li>
        <li>Verwende den Pluginspeicher nur für pluginspezifische Daten.</li>
        <li>Fordere eine neue typisierte Host-Fähigkeit an, wenn keine vorhandene Form passt.</li>
      </ol>
      <p>
        Spiegle Bücher, Fortschritt, Anmerkungen, Einstellungen oder Gedächtnis nicht im
        Pluginspeicher. Schattenzustand umgeht Produktinvarianten, festgeschriebene
        Ereignisse, Projektionswiederaufbau, Synchronisationssemantik und Agentenkontext.
      </p>

      <h2>Aktivierung deklarativ halten</h2>
      <p>
        Während <code>activate(ctx)</code> prüfe die Umgebung und registriere
        Aktionen, Befehle, Anbieter, Abonnements und Zeitpläne. Führe keine
        Geschäftsschreibvorgänge oder externe Arbeit aus. Der Host stellt jede
        Registrierung zwischen, bis die Aktivierungs-RPCs abgeschlossen sind und der Worker auf einen
        Gesundheits-Ping antwortet.
      </p>
      <p>
        Starte Laufzeitaufgaben nach der Aktivierung aus einem registrierten Handler. Wenn ein
        Handler ein Promise zurückgibt, soll der Host Lade- und Fehlerzustände anzeigen.
        Bewahre Referenzen auf externe Ressourcen nur auf, wenn dein optionaler{" "}
        <code>deactivate()</code> sie schließen muss; Host-Registrierungen und
        Abonnements werden automatisch freigegeben.
      </p>

      <h2>Private Daten ausdrücklich versionieren</h2>
      <p>
        <code>schemaVersion</code> versioniert Plugin-KV und Dokumentsammlungen;
        sie ist unabhängig von der Paketversion. Ändere sie nur, wenn sich die
        Struktur der privaten Daten ändert. Exportiere <code>migrate(storageCtx, change)</code>{" "}
        für jedes unterstützte Upgrade und Downgrade, nachdem ein Schema
        festgeschrieben wurde.
      </p>
      <ul>
        <li>Migrationen erhalten nur Speicher: keine Domänen, Einstellungen, Geheimnisse, Netzwerkzugriffe, UI, LLMs oder Beiträge.</li>
        <li>Mache jede Umwandlung deterministisch und idempotent.</li>
        <li>Teste einen Fehler nach Teilschreibvorgängen; der Host muss KV, Dokumente, Dateien und Schemadaten exakt wiederherstellen.</li>
        <li>Verwende keine Paketversionsprüfung als Ersatz für das Datenschema.</li>
      </ul>

      <h2>Arbeitsordner installieren</h2>
      <ol>
        <li>Führe Build und Prüfungen aus.</li>
        <li>Öffne ReadAware → Einstellungen → Plugins → Plugin installieren.</li>
        <li>Wähle den gebauten Plugin-Ordner und prüfe die Zustimmungsübersicht.</li>
        <li>Teste die tatsächliche Funktion in der Desktop-App.</li>
        <li>Baue neu und installiere erneut, um ein Update zu testen.</li>
      </ol>
      <p>
        Ein gewöhnlicher Browser kann Plugin-Installation, Worker-IPC, SQLite-
        Persistenz, Zugriff auf unveränderte Buchdateien, Reader-Integration oder Rollback
        nicht überprüfen. Teste die ausgelieferte Tauri-App.
      </p>

      <h2>Den Lebenszyklus testen, nicht nur den Erfolgsfall</h2>
      <ul>
        <li>Neu installieren, aktivieren, deaktivieren und ohne Neustart erneut aktivieren.</li>
        <li>Erfolgreiches Update und Downgrade mit echten Daten.</li>
        <li>Aktivierungs-Timeout, Ablehnung durch den Handler, Migrationsfehler und exaktes Rollback.</li>
        <li>Bereinigung bei der Deinstallation: keine übrig gebliebene Aktion, kein Listener, Zeitplan, Anbieter oder Worker.</li>
        <li>Berechtigungen während eines Updates entfernen und erweitern.</li>
        <li>Lange Beschriftungen, leere Zustände, Tastaturnavigation und alle Host-Themes.</li>
      </ul>

      <h2>Die aktuellen Grenzen kennen</h2>
      <p>
        Zeitpläne laufen, solange ReadAware geöffnet ist, mindestens in der deklarierten
        Frequenz; bei Überfälligkeit werden sie beim Start nachgeholt. Es sind keine dauerhaften Aufgaben:
        Bei geschlossener App gibt es keine Ausführung, keine persistierte Warteschlange,
        keinen Vertrag für Wiederholung/Backoff und keine Garantie zur Fortsetzung nach einem Absturz.
      </p>
      <p>
        UI ist nur an vorhandenen typisierten Beitragspunkten verfügbar. Eine fehlende
        Position erfordert einen vom Host verantworteten Beitrag und Verbraucher; beliebiges
        HTML oder eine allgemeine native Invoke-API wird nicht als Abkürzung hinzugefügt.
      </p>

      <h2>Weiter</h2>
      <p>
        Behalte die <Link to="/de/docs/plugins/api">API-Referenz</Link> neben deinem
        Editor und lies <Link to="/de/docs/plugins/publishing">Veröffentlichen</Link>, bevor
        du einen Pull Request für das Register vorbereitest.
      </p>
    </article>
  );
}

