import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/de/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "Pluginsystem — ReadAware-Dokumentation" },
      {
        name: "description",
        content:
          "Wie ReadAware-Plugins Produktdomänen erweitern, neue Fähigkeiten beitragen, Host-Dienste nutzen und innerhalb klarer Vertrauensgrenzen bleiben.",
      },
    ],
  }),
  component: PluginsOverviewPage,
});

function PluginsOverviewPage() {
  return (
    <article className="doc-prose">
      <h1>Pluginsystem</h1>
      <p className="lead">
        ReadAware-Plugins können mit Lesedaten arbeiten, native Aktionen und Anbieter hinzufügen, den Leseassistenten erweitern und den Host um begrenzte Dienste bitten. Installierte Pakete werden dynamisch geladen; die App benötigt keinen Schalter für jede Plugin-ID.
      </p>

      <h2>Ein Modell, drei Fähigkeitsfamilien</h2>
      <p>
        Jede ausführbare Plugin-Fähigkeit hat eine von drei Formen. Die richtige Form zu wählen, ist die erste Entscheidung beim Erstellen.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr><th>Familie</th><th>Verwende sie, wenn</th><th>Beispiele</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Domäne</strong></td>
              <td>ReadAware besitzt den Zustand oder das Verhalten bereits.</td>
              <td>Bibliothek, Lesen, Anmerkungen, Unterhaltungen, Einstellungen</td>
            </tr>
            <tr>
              <td><strong>Beitrag</strong></td>
              <td>Das Plugin liefert eine neue Auswahl oder Implementierung.</td>
              <td>Aktionen, Befehle, Stimmen, Inhalte, Designs, Agent-Anbieter</td>
            </tr>
            <tr>
              <td><strong>Dienst</strong></td>
              <td>Der Host muss eine begrenzte externe Operation ausführen.</td>
              <td>Speicher, Geheimnisse, Zeitpläne, Netzwerk, LLM, Zwischenablage</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Deklarative Ansichts-, Einstellungs- und Designs­chemata stehen neben diesen Familien. Sie beschreiben vom Host gerenderte Daten; sie verleihen keine zusätzliche Autorität.
      </p>

      <h2>Einstellungen sind eine Domäne</h2>
      <p>
        Darstellung ist ein Abschnitt der Einstellungen, keine separate Plugin-API. Ein Plugin, das das ausgewählte Design ändert, fordert genaue Einstellungspfade an, etwa{" "}
        <code>appearance.theme</code>. Ein Plugin, das ein neues Design bereitstellt, verwendet
        den <code>themes</code>-Beitrag. Auswählen und Bereitstellen sind bewusst getrennte Befugnisse.
      </p>

      <h2>Was Plugins hinzufügen können</h2>
      <ul>
        <li>Auswahl- und Kopfzeilenaktionen, Befehle der Befehlspalette und vom Host gerenderte Ansichten.</li>
        <li>Stimmen, Inhaltsanbieter für virtuelle Bücher, Lesemodi, Designs und Schriftarten.</li>
        <li>Agent-Werkzeuge, Kontext pro Runde, durchsuchbare private Quellen und Gedächtniskandidaten.</li>
        <li>Plugin-Einstellungen, dynamische Optionen, wiederkehrende Aufgaben, Speicher und verschlüsselte Geheimnisse.</li>
        <li>Lesezugriffe, Befehle und Abonnements für festgeschriebene Ereignisse in freigegebenen Produktdomänen.</li>
      </ul>
      <p>
        Die vollständige versionierte Liste findest du im{" "}
        <Link to="/de/docs/plugins/capabilities">Fähigkeitsbrowser</Link>. Sie
        enthält auch eine Berechtigungsvorschau für <code>manifest.json</code>.
      </p>

      <h2>Native UI, von Grund auf</h2>
      <p>
        Plugins binden weder React, HTML, CSS, iframes noch beliebiges DOM ein.
        Sie geben validierte Ansichtsdaten und Rückrufe zurück; ReadAware besitzt
        Layout, Navigation, Barrierefreiheit, Design-Kompatibilität, Ladezustände
        und Bereinigung. Neue visuelle Freiheit kommt als begrenztes Schema oder
        echter Host-Beitragspunkt hinzu, nicht als allgemeiner Webview-Ausweg.
      </p>

      <h2>Die Vertrauensgrenze</h2>
      <p>
        Jedes Plugin läuft in einem eigenen Modul-Worker. Es hat keinen Zugriff
        auf DOM, Tauri, SQLite, das Dateisystem oder Prozess-Handles; außerdem
        sind Umgebungs-APIs für Netzwerk und Browser-Persistenz deaktiviert.
        Host-Aufrufe überschreiten eine Nachrichtengrenze und werden anhand der
        auf den Plugin-Aktor begrenzten Fähigkeitsansicht aufgelöst.
      </p>
      <p>
        Das begrenzt versehentliche und direkte Überschreitungen, aber die Installation bleibt eine Vertrauensentscheidung für Software. Bevor Code läuft, zeigt ReadAware semantische Berechtigungen und genaue Einstellungsfreigaben. Fähigkeitsanforderungen werden getrennt geprüft: Die Berechtigung beantwortet „Darf es das?“, die Versionsanforderung „Kann es diesen Vertrag korrekt verwenden?“
      </p>

      <h2>Aktivierung und Aktualisierungen sind transaktional</h2>
      <p>
        <code>activate()</code> ist eine Lese- und Deklarationsphase. Registrierungen
        bleiben unsichtbar, während der Host Aufrufe abarbeitet und den Worker
        prüft; Schreibvorgänge, Geheimnisse, Netzwerk, LLM, Zwischenablage,
        UI-Effekte und Navigation sind blockiert. Persistente Datenänderungen
        werden später über ein speicherbegrenztes <code>migrate()</code>
        ausgeführt. Nur ein gesunder, migrierter Kandidat wird aktiviert.
      </p>
      <p>
        Aktualisierungen erstellen Snapshots von Dateien, Plugin-KV, Dokumentsammlungen und festgeschriebenen Schemadaten. Eine fehlgeschlagene Aktivierung oder Migration stellt die vorherigen Dateien und Daten wieder her und startet bei Bedarf die vorherige Laufzeit neu.
      </p>

      <h2>Aktuelles Ökosystem</h2>
      <p>
        Die heute ausgelieferten Plugins sind integriert oder stammen aus erster
        Hand: Dictionary, Editorial Themes, RSS Reader, Sentence Reader, TTS
        Voices und Theme Schedule. Das öffentliche{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins-Repository
        </a>{" "}
        enthält die Vorlage zur Plugin-Erstellung, öffentliche Deklarationen, die
        Validierung und das Marketplace-Register. Es gibt keine veraltete
        Drittanbieter-API, die erhalten werden müsste; der aktuelle Vertrag ist
        die Grundlage.
      </p>

      <h2>Entwicklung beginnen</h2>
      <p>
        Folge <Link to="/de/docs/plugins/develop">Plugin erstellen</Link> für den
        lokalen Entwicklungszyklus, nutze während der Implementierung die{" "}
        <Link to="/de/docs/plugins/api">API-Referenz</Link> und lies{" "}
        <Link to="/de/docs/plugins/publishing">Veröffentlichen</Link>, bevor du
        eine Änderung am Marketplace einreichst.
      </p>
    </article>
  );
}
