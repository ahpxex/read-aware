import { createFileRoute } from "@tanstack/react-router";
import {
  PluginCapabilityBrowser,
  type PluginCapabilityBrowserCopy,
} from "../../../../components/PluginCapabilityBrowser";
import {
  PluginPermissionPreview,
  type PluginPermissionPreviewCopy,
} from "../../../../components/PluginPermissionPreview";

export const Route = createFileRoute("/de/docs/plugins/capabilities")({
  head: () => ({
    meta: [
      { title: "Plugin-Fähigkeiten — ReadAware-Dokumentation" },
      {
        name: "description",
        content:
          "Alle versionierten ReadAware-Plugin-Fähigkeiten durchsuchen und die von einem Plugin-Manifest angeforderten Berechtigungen ansehen.",
      },
    ],
  }),
  component: PluginCapabilitiesPage,
});

const capabilityCopy: PluginCapabilityBrowserCopy = {
  searchLabel: "Fähigkeiten suchen",
  searchPlaceholder: "ID, Recht oder Zweck",
  familyLabel: "Fähigkeitsfamilie",
  authorityLabel: "Berechtigungstyp",
  allFamilies: "Alle Familien",
  allAuthorities: "Alle Berechtigungen",
  familyNames: {
    domains: "Domänen",
    contributions: "Beiträge",
    services: "Dienste",
    schemas: "Schemas",
  },
  authorityNames: {
    permission: "Berechtigung erforderlich",
    "permission-free": "Keine zusätzliche Berechtigung",
    "settings-grant": "Genaue Einstellungsfreigaben",
  },
  permissionFree: "keine",
  versionLabel: "v",
  permissionLabel: "Berechtigung",
  capabilityLabel: "Fähigkeit",
  purposeLabel: "Das Plugin kann",
  hostOwnsLabel: "Der Host behält",
  result: (count) => `${count} ${count === 1 ? "Fähigkeit" : "Fähigkeiten"}`,
  noResults: "Keine Fähigkeit entspricht diesen Filtern.",
  descriptions: {
    "domains:library": {
      purpose: "Bücher, Dateien, Metadaten, Inhaltsverzeichnisse und Sammlungen lesen sowie Bibliothekseinträge importieren oder entfernen.",
      hostOwns: "Bibliotheksinvarianten, ereignisbasierte Schreibvorgänge, Dateien und Projektionen.",
    },
    "domains:reading": {
      purpose: "Aktive Sitzung prüfen sowie Position, Fortschritt und Lesezeit anzeigen und aktualisieren.",
      hostOwns: "Leser-Lebenszyklus, Fortschrittssemantik und festgeschriebene Ereignisse.",
    },
    "domains:annotations": {
      purpose: "Highlights und Notizen über kanonische Befehle lesen oder ändern.",
      hostOwns: "Validierung, Zuordnung, Persistenz und Ereignisreihenfolge.",
    },
    "domains:conversations": {
      purpose: "Zusammenfassungen von Buch- und globalen Threads lesen.",
      hostOwns: "Unterhaltungsschreibvorgänge, Prompt-Zusammenstellung und Gedächtnis.",
    },
    "domains:settings": {
      purpose: "Explizit freigegebene Einstellungspfade entdecken, lesen, aktualisieren und abonnieren.",
      hostOwns: "Katalog, Ziele, Validierung, Persistenz und Änderungsfolgen.",
    },
    "contributions:selectionActions": {
      purpose: "Einen Befehl zu Auswahl- und Anmerkungsmenüs hinzufügen.",
      hostOwns: "Menüposition, Aufrufoberfläche, Laden und Barrierefreiheit.",
    },
    "contributions:headerActions": {
      purpose: "Eine Aktion in der Lese- oder Bibliotheksleiste mit vom Host gerenderter Ansicht hinzufügen.",
      hostOwns: "Position, Navigation, Popover, Seiten und Fokus.",
    },
    "contributions:commands": {
      purpose: "Einen ausdrücklichen Befehl der Befehlspalette hinzufügen.",
      hostOwns: "Register, Palette, Tastenkürzel und Ergebnisdarstellung.",
    },
    "contributions:settingsOptions": {
      purpose: "Dynamische Optionen für eine deklarierte Plugin-Einstellung auflösen.",
      hostOwns: "Formularrendering, Ersatzeingabe und Wertevalidierung.",
    },
    "contributions:voiceProviders": {
      purpose: "Stimmen auflisten und kodiertes Audio zum Vorlesen erzeugen.",
      hostOwns: "Wiedergabe, Tempo, Vorabruf, Hervorhebung und Fallback.",
    },
    "contributions:contentProviders": {
      purpose: "Abschnitte für virtuelle Bücher wie RSS-Feeds laden.",
      hostOwns: "Bibliotheksbindung, Lesemodell, Navigation und Darstellung.",
    },
    "contributions:readerModes": {
      purpose: "Begrenzte Satz- oder Absatzsegmentierung bereitstellen. Derzeit nur gebündelt.",
      hostOwns: "Lesesteuerung, Lebenszyklus, Darstellung und Navigation.",
    },
    "contributions:agentTools": {
      purpose: "Ein namensraumbezogenes Werkzeug registrieren, das der Leseassistent aufrufen darf.",
      hostOwns: "Orchestrierung, Werkzeugsichtbarkeit, Genehmigungen und Transkriptoberfläche.",
    },
    "contributions:agentContextProviders": {
      purpose: "Begrenzte Referenzblöcke für die aktuelle Nutzerrunde zurückgeben.",
      hostOwns: "Herkunft, Kürzung, Prompt-Position und Lebensdauer.",
    },
    "contributions:agentRetrievalProviders": {
      purpose: "Eine durchsuchbare Plugin-Quelle als namensraumbezogenes Agent-Werkzeug bereitstellen.",
      hostOwns: "Abfrageschema, Grenzen, Ergebniskürzung und Werkzeugbeschreibung.",
    },
    "contributions:memoryCandidateProviders": {
      purpose: "Nach einer Runde Fakten, Präferenzen, Einsichten oder Zusammenfassungen vorschlagen.",
      hostOwns: "Bereichsprüfung, Deduplizierung, Annahme und dauerhafte Gedächtnisschreibvorgänge.",
    },
    "contributions:themes": {
      purpose: "Semantische App- und Lesedesigndaten bereitstellen.",
      hostOwns: "Validierung, CSS-Erzeugung, Auswahl und Anwendung.",
    },
    "contributions:fonts": {
      purpose: "Genehmigte Schriftmetadaten und gebündelte Schriftressourcen bereitstellen.",
      hostOwns: "Dateivalidierung, Laden, Auswahlfeldeinträge und aktive Auswahl.",
    },
    "services:storage": {
      purpose: "Plugin-begrenztes KV und Dokumentsammlungen verwenden.",
      hostOwns: "Namensraumisolierung, Persistenz, Snapshots und Änderungsereignisse.",
    },
    "services:secrets": {
      purpose: "Zugangsdaten in Plugin-eigenen Geheimnis-Slots speichern und abrufen.",
      hostOwns: "Verschlüsselung, Geheimhaltung und Namensraumisolierung.",
    },
    "services:ui": {
      purpose: "Host-Toast anzeigen oder den Host-Ablauf zum Speichern/Exportieren öffnen.",
      hostOwns: "Darstellung, Pfadauswahl und Plattformintegration.",
    },
    "services:schedules": {
      purpose: "Arbeit an eine im Manifest deklarierte wiederkehrende Aufgabe binden.",
      hostOwns: "Frequenz, Nachholen beim Start, Überschneidungsvermeidung und Freigabe.",
    },
    "services:session": {
      purpose: "Begrenzte Fakten über die aktuelle Lesesitzung abonnieren.",
      hostOwns: "Ereignisquelle, Payload-Grenzen und Abonnement-Lebenszyklus.",
    },
    "services:network": {
      purpose: "HTTP-Anfragen über den nativen Host-Client stellen.",
      hostOwns: "Durchsetzung von Berechtigungen, Transport und Antwortbrücke.",
    },
    "services:llm": {
      purpose: "Begrenzte einmalige Text- oder strukturierte Modellaufrufe ausführen.",
      hostOwns: "Anbieterkonfiguration, Zugangsdaten, Schemaverarbeitung und Grenzen.",
    },
    "services:clipboard": {
      purpose: "Text in die Systemzwischenablage schreiben.",
      hostOwns: "Plattformaufruf und Durchsetzung von Berechtigungen.",
    },
    "schemas:views": {
      purpose: "Markdown, Listen, Formulare, Details und begrenzte Blockbäume zurückgeben.",
      hostOwns: "Komponenten, HTML-Sicherheit, Layout, Barrierefreiheit und Navigation.",
    },
    "schemas:settings": {
      purpose: "Vom Host gerenderte Plugin-Einstellungsfelder deklarieren.",
      hostOwns: "Formularverhalten, Validierung, Speicherweiterleitung und Geheimnisverarbeitung.",
    },
    "schemas:themes": {
      purpose: "Semantische Designtoken und gebündelte Schriftmetadaten deklarieren.",
      hostOwns: "Grammatikvalidierung, generiertes CSS, Laden und Auswahl.",
    },
  },
};

const permissionCopy: PluginPermissionPreviewCopy = {
  inputLabel: "manifest.json",
  inputHint: "Nur auf dieser Seite geparst. Nichts wird hochgeladen.",
  previewLabel: "Prüfvorschau",
  noAuthority: "Dieses Manifest fordert keine semantischen Berechtigungen oder Einstellungsfreigaben an.",
  invalidJson: "Gib ein gültiges JSON-Objekt ein.",
  issuesTitle: "Prüfhinweise",
  permissionsTitle: "Nutzerberechtigung · semantische Berechtigungen",
  settingsTitle: "Nutzerberechtigung · genaue Einstellungsfreigaben",
  requirementsTitle: "Kompatibilität · keine Berechtigungen",
  declarationsTitle: "Betriebsdeklarationen · keine Berechtigungen",
  none: "Nichts deklariert",
  schemaVersion: "Schema privater Daten",
  schedules: (count) => `${count} ${count === 1 ? "wiederkehrende Aufgabe" : "wiederkehrende Aufgaben"}`,
  themes: (count) => `${count} ${count === 1 ? "Design" : "Designs"}`,
  fonts: (count) => `${count} ${count === 1 ? "gebündelte Schriftdeklaration" : "gebündelte Schriftdeklarationen"}`,
  unknownPermission: (permission) => `Unbekannte Berechtigung: ${permission}`,
  missingField: (field) => `Erforderliches Feld fehlt: ${field}`,
  invalidSchemaVersion: "schemaVersion muss eine positive Ganzzahl sein.",
  invalidPermissions: "permissions muss ein Array sein.",
  invalidSettingsAccess: "settingsAccess muss ein Objekt sein.",
  unknownSettingsOperation: (operation) => `Unbekannte Einstellungsoperation: ${operation}`,
  invalidSettingsGrant: (operation) => `${operation} muss genaue Pfade oder section.*-Gruppen enthalten.`,
  sectionGrantWarning: (path) => `${path} gibt einen ganzen Einstellungsabschnitt frei; bevorzuge nach Möglichkeit genaue Pfade.`,
  permissionDescriptions: {
    "library:read": "Bücher, Quelltext, Metadaten, Inhaltsverzeichnisse und Sammlungen lesen.",
    "library:write": "Bibliothek ändern; Schreiben umfasst Lesen.",
    "reading:read": "Aktive Sitzung, Position, Fortschritt und Lesezeit lesen.",
    "reading:write": "Lesestatus navigieren und ändern; Schreiben umfasst Lesen.",
    "annotations:read": "Highlights und Notizen lesen.",
    "annotations:write": "Anmerkungen erstellen, bearbeiten und entfernen; Schreiben umfasst Lesen.",
    "conversations:read": "Zusammenfassungen von Buch- und globalen Unterhaltungen lesen.",
    "reader:modes": "Geführten Lesemodus registrieren; derzeit nur gebündelt.",
    "agent:tools": "Werkzeuge registrieren, die der Leseassistent aufrufen darf.",
    "agent:context": "Begrenzte nicht vertrauenswürdige Referenzblöcke zu einer Runde hinzufügen.",
    "agent:retrieval": "Eine durchsuchbare Plugin-Quelle für den Assistenten bereitstellen.",
    "agent:memory": "Vom Host geprüfte dauerhafte Gedächtniskandidaten vorschlagen.",
    "ui:themes": "App-Designs, Lesedesigns und gebündelte Schriften bereitstellen.",
    "service:network": "Vom Host vermittelte Netzwerkanfragen stellen.",
    "service:llm": "Das konfigurierte Modell für begrenzte einmalige Aufrufe verwenden.",
    "service:clipboard": "Text in die Systemzwischenablage schreiben.",
  },
  operationLabels: { discover: "Entdecken", read: "Lesen", write: "Schreiben" },
  familyLabels: {
    domains: "Domäne",
    contributions: "Beitrag",
    services: "Dienst",
    schemas: "Schema",
  },
};

const sampleManifest = `{
  "id": "research-notes",
  "name": "Forschungsnotizen",
  "version": "0.1.0",
  "schemaVersion": 1,
  "requires": {
    "domains": {
      "annotations": "^1.0.0",
      "settings": "^1.0.0"
    },
    "contributions": {
      "commands": "^1.0.0",
      "agentRetrievalProviders": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "network": "^1.0.0"
    },
    "schemas": {
      "settings": "^1.0.0"
    }
  },
  "permissions": [
    "annotations:read",
    "agent:retrieval",
    "service:network"
  ],
  "settingsAccess": {
    "discover": ["appearance.theme"],
    "read": ["appearance.theme"]
  },
  "schedules": [
    {
      "id": "refresh",
      "label": "Quellen aktualisieren",
      "everyMinutes": 60
    }
  ],
  "main": "main.js"
}`;

function PluginCapabilitiesPage() {
  return (
    <article className="doc-prose">
      <h1>Fähigkeitsübersicht</h1>
      <p className="lead">
        Durchsuche vor dem Entwurf eines Plugins den vollständigen öffentlichen Katalog. Jede
        Fähigkeit ist unabhängig versioniert; jede Abhängigkeit gehört in den
        Abschnitt <code>requires</code> des Manifests.
      </p>

      <PluginCapabilityBrowser copy={capabilityCopy} />

      <h2>Katalog lesen</h2>
      <ul>
        <li><strong>Berechtigung</strong> bezeichnet die beim Aufruf benötigte Berechtigung oder genaue Einstellungsfreigabe.</li>
        <li><strong>Keine</strong> bedeutet keine zusätzliche Installationsberechtigung, nicht eine undokumentierte Umgebungsbefugnis.</li>
        <li><strong>Der Host behält</strong> markiert die Grenze, die das Plugin nicht ersetzen oder umgehen kann.</li>
        <li>Die Version neben jedem Eintrag stammt direkt aus dem kanonischen Fähigkeitskatalog des Hosts.</li>
      </ul>
      <p>
        <code>readerModes</code> bleibt auf gebündelte Plugins beschränkt, bis
        sein privilegierter Leservertrag feststeht. Ein Manifest darf nur
        katalogisierte Fähigkeiten benennen; der Host filtert die sichtbare
        Laufzeitansicht weiterhin nach Akteur, Berechtigung, Version und
        Lebenszyklusphase.
      </p>

      <h2>Berechtigungsvorschau</h2>
      <p>
        Füge ein Manifest ein, um die Nutzerberechtigung von Kompatibilitäts- und
        Betriebsdeklarationen zu trennen. Dies spiegelt die Bedeutung der
        Installationszustimmung wider; es ersetzt weder den Repository-Validator
        noch beweist es, dass ein Plugin aktiviert werden kann.
      </p>

      <PluginPermissionPreview copy={permissionCopy} sampleManifest={sampleManifest} />

      <h2>Was der Installationsdialog tatsächlich gewährt</h2>
      <p>
        Semantische <code>permissions</code>- und genaue <code>settingsAccess</code>-Einträge
        gewähren Berechtigungen. Der ausgelieferte Zustimmungsdialog zeigt beide in
        verständlicher Sprache. Fähigkeitsanforderungen, Zeitpläne, Schemaversion,
        Designs und Schriften sind nützlicher Prüfungskontext, werden aber nicht
        stillschweigend als Berechtigungen umbenannt.
      </p>
      <p>
        Diese Vorschau ist bewusst lokal und zustandslos. Der nächste
        Entwicklungsschritt ist eine in der App integrierte Akteursansicht und
        ein Lebenszyklusinspektor auf Basis derselben Laufzeitkataloge, mit
        Berechtigungsunterschieden bei Updates und genauen Gründen für nicht
        verfügbare Fähigkeiten.
      </p>
    </article>
  );
}
