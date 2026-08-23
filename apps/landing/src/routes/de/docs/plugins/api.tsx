import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/de/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "Plugin-API-Referenz — ReadAware-Dokumentation" },
      {
        name: "description",
        content:
          "Der aktuelle ReadAware-Pluginvertrag: Manifest, Fähigkeiten, Domänen, Beiträge, Dienste, deklarative UI, Lebenszyklus und Migrationen.",
      },
    ],
  }),
  component: PluginApiPage,
});

function PluginApiPage() {
  return (
    <article className="doc-prose">
      <h1>Plugin-API-Referenz</h1>
      <p className="lead">
        Ein Plugin ist ein Ordner mit <code>manifest.json</code> und einem gebauten ES-Modul. Der vollständige öffentliche TypeScript-Vertrag wird als{" "}
        <code>types/plugin-api.d.ts</code> im{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins-Repository
        </a>. Diese Seite erklärt, wie die Teile zusammenspielen.
      </p>

      <h2>Paketstruktur</h2>
      <pre><code>{`my-plugin/
  manifest.json
  main.js
  src/main.ts       # empfohlen und zur Prüfung eingecheckt
  assets/           # optional, für Marktplatzinstallationen ausdrücklich aufgeführt`}</code></pre>
      <p>
        <code>main.js</code> exportiert standardmäßig ein Lebenszyklusobjekt. ReadAware führt
        es in einem eigenen Modul-Worker aus und übergibt <code>activate</code> einen
        auf den Akteur begrenzten Kontext.
      </p>
      <pre><code>{`export default {
  activate(ctx) {
    // Prüfen und registrieren. Nebenwirkungen sind in dieser Phase blockiert.
  },
  migrate(storageCtx, change) {
    // Optional: Private Plugin-KV-Daten und Dokumente umwandeln.
  },
  deactivate() {
    // Optional: Eigene externe Plugin-Ressourcen freigeben.
  },
};`}</code></pre>

      <h2>Manifest</h2>
      <pre><code>{`{
  "id": "theme-schedule",
  "name": "Design-Zeitplan",
  "version": "0.1.0",
  "schemaVersion": 1,
  "minAppVersion": "0.3.0",
  "requires": {
    "domains": { "settings": "^1.0.0" },
    "contributions": {
      "commands": "^1.0.0",
      "settingsOptions": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "ui": "^1.0.0"
    },
    "schemas": { "settings": "^1.0.0" }
  },
  "settingsAccess": {
    "discover": ["appearance.theme", "reading.theme"],
    "write": ["appearance.theme", "reading.theme"]
  },
  "main": "main.js"
}`}</code></pre>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Feld</th><th>Vertrag</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>Kleinbuchstaben, Ziffern und Bindestriche; maximal 64 Zeichen. Dies ist der dauerhafte Namensraum und muss dem Ordnernamen entsprechen.</td></tr>
            <tr><td><code>name</code>, <code>version</code></td><td>Für Nutzer sichtbarer Name und Paketversion.</td></tr>
            <tr><td><code>schemaVersion</code></td><td>Erforderliche positive Ganzzahl für private Plugin-KV- und Dokumentdaten. Unabhängig von der Paketversion.</td></tr>
            <tr><td><code>requires</code></td><td>Erforderliche Zuordnung von Fähigkeits-IDs zu Semver-Bereichen, gruppiert nach Domänen, Beiträgen, Diensten und Schemata.</td></tr>
            <tr><td><code>permissions</code></td><td>Optionale semantische Berechtigung, die vom Nutzer angefordert wird. Unbekannte Werte schlagen bei der Validierung fehl.</td></tr>
            <tr><td><code>settingsAccess</code></td><td>Optionale discover/read/write-Freigaben für genaue Einstellungspfade oder ausdrückliche <code>section.*</code>-Gruppen.</td></tr>
            <tr><td><code>minAppVersion</code></td><td>Optionale Mindestversion der App. Verwende sie, wenn das Paket von einer neu ausgelieferten Fähigkeit abhängt.</td></tr>
            <tr><td><code>settings</code></td><td>Optionale vom Host gerenderte Plugin-Einstellungsfelder.</td></tr>
            <tr><td><code>schedules</code></td><td>Optionale wiederkehrende Aufgaben, die vor der Bindung ihrer Handler deklariert werden.</td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>Optionale deklarative Design- und Schriftbeiträge; benötigt <code>ui:themes</code>.</td></tr>
            <tr><td><code>main</code></td><td>Einstiegsmodul relativ zum Ordner; standardmäßig <code>main.js</code>.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Verwende den <Link to="/de/docs/plugins/capabilities">Fähigkeitsbrowser</Link>{" "}
        für die vollständige Liste und das Berechtigungslexikon. Eine Anforderung ist
        immer eine Kompatibilitätsaussage; sie gewährt niemals eine Berechtigung.
      </p>

      <h2>Laufzeitkontext</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Namensraum</th><th>Enthält</th></tr></thead>
          <tbody>
            <tr><td><code>ctx.manifest</code></td><td>Das validierte Manifest, schreibgeschützt.</td></tr>
            <tr><td><code>ctx.appVersion</code>, <code>ctx.locale</code></td><td>Host-Version und aktuelles UI-Gebietsschema.</td></tr>
            <tr><td><code>ctx.lifecycle.phase</code></td><td><code>activating</code>, <code>migrating</code> oder <code>active</code>.</td></tr>
            <tr><td><code>ctx.capabilities</code></td><td>Nur die für diesen Plugin-Akteur sichtbaren Fähigkeitsversionen.</td></tr>
            <tr><td><code>ctx.domains</code></td><td>Freigegebener, von ReadAware besessener Zustand und Verhalten.</td></tr>
            <tr><td><code>ctx.contributions</code></td><td>Register, in denen das Plugin Implementierungen bereitstellen darf.</td></tr>
            <tr><td><code>ctx.services</code></td><td>Begrenzte Host-Operationen und private Plugin-Infrastruktur.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Berechtigungsgeschützte Namensräume fehlen ohne Freigabe. Jeder Worker-
        Aufruf wird außerdem hostseitig autorisiert; das Verbergen einer Methode ist nicht die einzige
        Prüfung. Registrierungen geben ein entsorgbares Objekt zurück und werden in umgekehrter
        Reihenfolge zurückgenommen, wenn die Aktivierung fehlschlägt oder das Plugin deaktiviert wird.
      </p>

      <h2>Domänen</h2>
      <p>
        Eine Domäne stellt <code>queries</code>, optionale <code>commands</code>
        und <code>events.subscribe</code> für festgeschriebene Ereignisse bereit.
        Befehle verwenden denselben ereignisbasierten Schreibpfad wie ReadAware
        und werden <code>plugin:&lt;id&gt;</code> zugeordnet. Eine
        Schreibberechtigung schließt Leseberechtigung ein.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Domäne</th><th>Abfragen und Befehle</th><th>Berechtigung</th></tr></thead>
          <tbody>
            <tr>
              <td><code>library</code></td>
              <td>Bücher, Metadaten, Quelltext von Kapiteln, Inhaltsverzeichnis und Sammlungen; Befehle zum Importieren, Bearbeiten, Markieren, Entfernen, Erstellen virtueller Bücher und Verwalten von Sammlungen.</td>
              <td><code>library:read</code> / <code>library:write</code></td>
            </tr>
            <tr>
              <td><code>reading</code></td>
              <td>Lesestatistiken pro Buch und insgesamt; als beendet markieren, ein Buch öffnen und zu CFI oder href navigieren.</td>
              <td><code>reading:read</code> / <code>reading:write</code></td>
            </tr>
            <tr>
              <td><code>annotations</code></td>
              <td>Highlights, Notizen und passive Fragespuren filtern; Highlights oder Notizen erstellen, bearbeiten, umfärben und entfernen.</td>
              <td><code>annotations:read</code> / <code>annotations:write</code></td>
            </tr>
            <tr>
              <td><code>conversations</code></td>
              <td>Buch-Threads lesen, globale Threads auflisten und einen Thread lesen. Schreibvorgänge bleiben bei der Chat-Laufzeit.</td>
              <td><code>conversations:read</code></td>
            </tr>
            <tr>
              <td><code>settings</code></td>
              <td>Freigegebene Katalogeinträge entdecken, aufgelöste Werte lesen, unterstützte Ziele aktualisieren und festgeschriebene Änderungen abonnieren.</td>
              <td>Genaue <code>settingsAccess</code>-Freigaben</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Es gibt keine <code>shelf</code>- oder <code>appearance</code>-Domäne.
        Bibliotheksdaten und aktives Leseverhalten sind getrennt. Darstellung ist ein
        Abschnitt innerhalb der Einstellungen.
      </p>

      <h3>Zugriff auf Einstellungen</h3>
      <p>
        <code>discover</code>, <code>read</code> und <code>write</code> sind
        unabhängig. Vergib möglichst genaue Pfade; verwende eine Abschnittsgruppe
        wie <code>appearance.*</code> nur, wenn die Funktion wirklich
        den gesamten Abschnitt benötigt. Aktualisierungen durchlaufen Katalogvalidierung, Zielrichtlinie,
        Persistenz und Effekte nach dem Commit.
      </p>
      <pre><code>{`const entries = await ctx.domains.settings.queries.discover({
  section: "appearance",
});

await ctx.domains.settings.commands.update([
  {
    path: "appearance.theme",
    value: "dark",
    target: { kind: "global" },
  },
]);`}</code></pre>

      <h2>Beiträge</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Register</th><th>Plugin liefert</th><th>Berechtigung</th></tr></thead>
          <tbody>
            <tr><td><code>selectionActions</code></td><td>Auswahlaktion und Handler, der einen Toast oder eine vom Host gerenderte Ansicht zurückgibt.</td><td>Keine</td></tr>
            <tr><td><code>headerActions</code></td><td>Lese- oder Bibliotheksaktion, Platzierungsmetadaten und Ansichts-Callback.</td><td>Keine</td></tr>
            <tr><td><code>commands</code></td><td>Befehlsmetadaten und Handler.</td><td>Keine</td></tr>
            <tr><td><code>settingsOptions</code></td><td>Dynamische Optionen für ein deklariertes Pluginfeld.</td><td>Keine</td></tr>
            <tr><td><code>voiceProviders</code></td><td>Stimmenliste und Erzeugung kodierten Audios.</td><td>Keine</td></tr>
            <tr><td><code>contentProviders</code></td><td>Abschnitte für einen Schlüssel eines virtuellen Buchs.</td><td>Keine</td></tr>
            <tr><td><code>readerModes</code></td><td>Begrenzter Modus zur Lesesegmentierung; derzeit nur für gebündelte Plugins.</td><td><code>reader:modes</code></td></tr>
            <tr><td><code>agentTools</code></td><td>Werkzeugschema, verständliche Bezeichnung, Beschreibung und Ausführer.</td><td><code>agent:tools</code></td></tr>
            <tr><td><code>agentContextProviders</code></td><td>Begrenzte Referenzblöcke für die aktuelle Runde.</td><td><code>agent:context</code></td></tr>
            <tr><td><code>agentRetrievalProviders</code></td><td>Suchergebnisse aus Plugin-eigenen Daten.</td><td><code>agent:retrieval</code></td></tr>
            <tr><td><code>memoryCandidateProviders</code></td><td>Mögliche dauerhafte Fakten, Präferenzen, Einsichten oder Zusammenfassungen.</td><td><code>agent:memory</code></td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>Im Manifest deklarierte semantische Design- und Schriftinformationen.</td><td><code>ui:themes</code></td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Jede Beitrags-ID hat einen Plugin-Namensraum, jede Registrierung ist
        einem Besitzer zugeordnet und einsehbar; veraltete entsorgbare Objekte
        können keinen neueren Ersatz entfernen. Eine neue Beitragsart benötigt
        weiterhin einen bewusst vorgesehenen Host-Verbraucher; danach kann sich
        jedes kompatible Plugin registrieren, ohne von der App einzeln benannt zu
        werden.
      </p>

      <h3>Grenzen der Assistentenerweiterung</h3>
      <ul>
        <li><strong>Kontextanbieter</strong> laufen eine Runde. Der Host ergänzt Herkunft, begrenzt die Größe und serialisiert die Ausgabe als nicht vertrauenswürdige Referenzdaten.</li>
        <li><strong>Abrufanbieter</strong> werden zu namensraumbezogenen Werkzeugen mit einem vom Host verwalteten <code>query</code>/<code>limit</code>-Schema und gekürzten Ergebnissen.</li>
        <li><strong>Anbieter für Gedächtniskandidaten</strong> schlagen nach einer Runde begrenzte Kandidaten vor; der Host prüft den Bereich, dedupliziert und führt dauerhafte Schreibvorgänge aus.</li>
      </ul>
      <p>
        Plugins erhalten niemals den Memory-Port, können keine Systemregeln einschleusen und
        können langfristiges Gedächtnis nicht direkt schreiben.
      </p>

      <h2>Host-Dienste</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Dienst</th><th>Vertrag</th><th>Berechtigung</th></tr></thead>
          <tbody>
            <tr><td><code>storage</code></td><td>Namensraum-KV, Dokumentsammlungen und Benachrichtigungen über externe Änderungen.</td><td>Keine</td></tr>
            <tr><td><code>secrets</code></td><td>Verschlüsselte Zugangsdaten-Slots mit eigenem Namensraum.</td><td>Keine</td></tr>
            <tr><td><code>ui</code></td><td>Host-Toast und Speichern-/Exportieren-Ablauf.</td><td>Keine</td></tr>
            <tr><td><code>schedules</code></td><td>Einen Handler an eine im Manifest deklarierte Frequenz binden.</td><td>Keine</td></tr>
            <tr><td><code>session</code></td><td>Begrenzte Fakten der Lesesitzung abonnieren.</td><td>Keine</td></tr>
            <tr><td><code>network</code></td><td>Vom Host vermitteltes HTTP.</td><td><code>service:network</code></td></tr>
            <tr><td><code>llm</code></td><td>Einmalige Text- oder JSON-Schema-beschränkte Modellaufrufe mit der Konfiguration des Nutzers.</td><td><code>service:llm</code></td></tr>
            <tr><td><code>clipboard</code></td><td>Text in die Systemzwischenablage schreiben.</td><td><code>service:clipboard</code></td></tr>
          </tbody>
        </table>
      </div>

      <h3>Speicher</h3>
      <p>
        Verwende KV für kleine Einstellungen und Checkpoints. Verwende eine benannte Dokumentsammlung
        für Plugin-eigene Datensätze mit stabilen IDs und optionaler{" "}
        <code>bookId</code>/<code>anchor</code>-Herkunft. Herkunft ist ein
        Index, keine Besitzzuordnung; ein Dokument kann die Löschung des referenzierten
        Buches. Die Deinstallation leert Dokumentsammlungen, behält aber KV, Geheimnis-
        Slots und festgeschriebene Schemadaten für Neuinstallation und Migration.
      </p>

      <h3>Zeitpläne</h3>
      <p>
        Das Manifest deklariert <code>{`{ id, label, everyMinutes }`}</code> und
        die Aktivierung bindet den Handler über{" "}
        <code>ctx.services.schedules.bind</code>. Die Mindestfrequenz beträgt 15
        Minuten. Bei geöffneter App läuft es mindestens in dieser Frequenz,
        wird bei Überfälligkeit nach dem Start nachgeholt und überschneidet sich nicht. Dies ist kein
        dauerhafter Hintergrundjob und keine Garantie für exakte Zeitpunkte.
      </p>

      <h2>Deklarative UI und Einstellungen</h2>
      <p>
        Plugins liefern versionierte Ansichtsdaten statt ausführbarer UI. Die Ansichtssyntax
        umfasst Markdown, durchsuchbare Listen, Formulare, Detail-Layouts, Wörterbuch-
        ergebnisse und begrenzte Blockbäume. Handler können die Oberfläche behalten, einen
        Toast anzeigen, eine Ansicht öffnen oder ersetzen, Navigation zurücksetzen, die Oberfläche schließen oder
        Feldfehler zurückgeben. Der Host besitzt Lade- und Fehlerzustände für
        Promises.
      </p>
      <p>
        Manifest-Einstellungen verwenden Host-Steuerelemente für Text, Textbereich, Zahl, Zeit,
        Auswahl, Option, Kontrollkästchen, Umschalter und Geheimnisfelder. Bedingte Felder
        verwenden <code>visibleWhen</code>; dynamische Auswahlen verwenden einen registrierten{" "}
        <code>settingsOptions</code>-Anbieter. Geheimnisfelder schreiben direkt in
        verschlüsselte Geheimnis-Slots und gelangen nie in das normale Einstellungsobjekt oder den
        für den Agenten sichtbaren Katalog.
      </p>

      <h2>Designs und Schriften</h2>
      <p>
        Theme-Plugins deklarieren semantische Daten im Manifest. Ein App-Design
        überschreibt ein festes Host-Token-Vokabular; ein Lesedesign liefert die
        erforderliche sechsfarbige Seitenpalette und optionale Typografie-Standardwerte. Der
        Host validiert Werte, erzeugt CSS, lädt genehmigte lokale Schriftdateien
        und wendet nichts an, bis der Nutzer es auswählt.
      </p>
      <p>
        Das Anbieten von Auswahlmöglichkeiten benötigt <code>ui:themes</code>.
        Die Auswahl eines Designs benötigt eine genaue Einstellungsfreigabe wie
        <code>appearance.theme</code> oder{" "}
        <code>reading.theme</code>. Das eine impliziert nicht das andere.
      </p>

      <h2>Lebenszyklusphasen</h2>
      <ol>
        <li><strong>Aktivierung:</strong> Abfragen und private Plugin-Lesevorgänge sind verfügbar; Registrierungen werden vorbereitet; Nebenwirkungen sind blockiert.</li>
        <li><strong>Migration:</strong> Nur Plugin-KV und Dokumentsammlungen sind verfügbar.</li>
        <li><strong>Aktiv:</strong> Aktivierte Handler dürfen ihre freigegebenen Domänen, Beiträge und Dienste verwenden.</li>
      </ol>
      <p>
        Der Host leert Aktivierungs-RPCs, prüft den Worker, führt jede Daten-
        migration aus und aktiviert dann die vollständige vorbereitete Menge an einem klaren Punkt.
        Eine fehlgeschlagene Aktivierung verwirft vorbereitete Arbeit, ohne die aktuelle
        Laufzeit zu ersetzen.
      </p>

      <h2>Worker-Umgebung</h2>
      <p>
        Es gibt keinen Zugriff auf React, Jotai, DOM, WebView, Tauri, SQLite, Dateisystem oder
        Prozesse. Die Umgebungs-APIs <code>fetch</code>, WebSocket, EventSource,
        XMLHttpRequest, BroadcastChannel, IndexedDB und Cache Storage sind
        deaktiviert. Verwende den typisierten Kontext für Netzwerk, Persistenz und jede
        Host-Interaktion.
      </p>

      <h2>Kompatibilität und Stabilität</h2>
      <p>
        Domänen, Beiträge, Dienste und deklarative Schemata besitzen jeweils
        eine unabhängige semantische Version. Unbekannte IDs, ungültige Semver-Bereiche,
        nicht zugängliche erforderliche Fähigkeiten und inkompatible Host-Versionen
        verhindern die Aktivierung. Kompatible Erweiterungen erhöhen die Version der zuständigen Fähigkeit,
        nicht eine globale Plugin-API-Nummer.
      </p>
      <p>
        Das aktuelle Ökosystem ist offiziell, daher ist der aktuelle vom Register gestützte
        Vertrag die Grundlage. Verlasse dich nicht auf frühere <code>shelf</code>,{" "}
        <code>appearance</code> oder auf Formen aus der Zeit vor dem Register.
      </p>
    </article>
  );
}
