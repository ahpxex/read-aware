import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/de/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "Plugin-API-Referenz — ReadAware Dokumentation" },
      {
        name: "description",
        content:
          "Der ReadAware-Plugin-Autorenvertrag: Manifest, Lebenszyklus, domänenabgeleitete Berechtigungen, Daten-APIs, Contributions, Views und Events.",
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
        Ein Plugin ist ein Ordner, der eine <code>manifest.json</code> und ein
        JavaScript-Modul enthält. Diese Seite ist der Autorenvertrag; derselbe
        Vertrag wird als TypeScript-Deklarationsdatei
        (<code>types/plugin-api.d.ts</code>) im{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          Marktplatz-Repository
        </a>{" "}
        ausgeliefert, sodass Editoren alles unten automatisch vervollständigen.
      </p>

      <h2>Anatomie</h2>
      <pre>
        <code>{`my-plugin/
  manifest.json
  main.js        # ein in sich geschlossenes ES-Modul`}</code>
      </pre>
      <p>
        <code>main.js</code> exportiert standardmäßig ein Lebenszyklus-Objekt. Alles,
        was ein Plugin erreichen kann, kommt durch den Kontext, der an{" "}
        <code>activate</code> übergeben wird; jeder <code>register*</code>- und{" "}
        <code>on</code>-Aufruf gibt ein Disposable zurück, das die App zurückfordert,
        wenn das Plugin deaktiviert oder deinstalliert wird, sodass{" "}
        <code>deactivate</code> nur die eigenen externen Ressourcen des Plugins
        freigeben muss.
      </p>
      <pre>
        <code>{`export default {
  activate(ctx) {
    // Beiträge über ctx registrieren
  },
  deactivate() {
    // optional: Sockets schließen, Warteschlangen leeren
  },
};`}</code>
      </pre>
      <p>
        Aktivieren und Deaktivieren wirken sich sofort aus — kein App-Neustart.
        Schreib gern in TypeScript (empfohlen; siehe{" "}
        <Link to="/de/docs/plugins/publishing">Veröffentlichen</Link>) — was die App
        lädt, ist immer die gebaute <code>main.js</code>.
      </p>

      <h2>manifest.json</h2>
      <pre>
        <code>{`{
  "id": "anki-sync",
  "name": "Anki Sync",
  "version": "0.1.0",
  "minAppVersion": "0.3.0",
  "description": "Send looked-up words to Anki.",
  "author": "you",
  "permissions": ["service:network", "annotations:read"],
  "main": "main.js"
}`}</code>
      </pre>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Feld</th>
              <th>Bedeutung</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>id</code>
              </td>
              <td>
                Kleinbuchstaben, Ziffern, Bindestriche (max. 64). Muss dem Ordnernamen
                entsprechen; legt den Namensraum für Speicher und Werkzeuge des
                Plugins fest.
              </td>
            </tr>
            <tr>
              <td>
                <code>name</code>, <code>version</code>
              </td>
              <td>Angezeigt in Einstellungen → Plugins und im Marktplatz.</td>
            </tr>
            <tr>
              <td>
                <code>minAppVersion</code>
              </td>
              <td>
                Niedrigste App-Version, die das Plugin unterstützt. Dieser Vertrag
                erfordert <code>0.3.0</code> oder neuer.
              </td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                Was das Plugin benutzt (Tabelle unten). Wird dir vor der
                Installation angezeigt.
              </td>
            </tr>
            <tr>
              <td>
                <code>main</code>
              </td>
              <td>
                Einstiegsmodul relativ zum Ordner; Standardwert ist{" "}
                <code>main.js</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>settings</code>
              </td>
              <td>
                Optionale deklarative Einstellungen (dieselben Feldformen wie
                Formularansichten, plus <code>secret</code>). Die App rendert sie als
                eigene Sektion des Plugins in den Einstellungen und persistiert die
                Werte als ein Objekt unter dem Speicherschlüssel{" "}
                <code>settings</code> — siehe{" "}
                <a href="#storage-and-settings">Speicher und Einstellungen</a>.
              </td>
            </tr>
            <tr>
              <td>
                <code>schedules</code>
              </td>
              <td>
                Optionale wiederkehrende Aufgaben, deklariert, damit du sie vor
                der Installation siehst — siehe{" "}
                <a href="#scheduled-work">Geplante Arbeit</a>.
              </td>
            </tr>
            <tr>
              <td>
                <code>themes</code>, <code>fonts</code>
              </td>
              <td>
                Optionale deklarative Themes und gebündelte Schriften (erfordert{" "}
                <code>ui:themes</code>) — siehe{" "}
                <a href="#themes-and-bundled-fonts">
                  Themes und gebündelte Schriften
                </a>
                .
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Das Domänenmodell</h2>
      <p>
        Die Datenoberfläche wird vom Domänenmodell der App abgeleitet, anstatt daneben
        erstellt zu werden. Jede Domäne — <code>shelf</code> (die gesamte
        Bibliotheksverwaltung: Bücher, Sammlungen, Lesestatistiken),{" "}
        <code>annotations</code>, <code>conversations</code> — ist ein Namensraum auf{" "}
        <code>ctx</code>, der drei Dinge bereitstellt:
      </p>
      <ul>
        <li>
          <strong>Lesevorgänge</strong> — die Lesemodelle der Domäne (was die eigenen
          Oberflächen der App rendern);
        </li>
        <li>
          <strong>Schreibvorgänge</strong> — Befehle unter <code>.write</code>, die
          genau die Event-Verben der Domäne spiegeln und über den eigenen
          event-sourced Schreibpfad der App gehen, gestempelt mit{" "}
          <code>plugin:&lt;id&gt;</code> im Event-Log, sodass jeder Plugin-Schreibvorgang
          zurechenbar ist;
        </li>
        <li>
          <strong>Abonnements</strong> — <code>.on(event, handler)</code> über die
          Events der Domäne unter ihren kanonischen Namen (
          <code>book.starred</code>, <code>highlight.created</code>, …) — das gleiche
          Vokabular, das die App selbst aufzeichnet.
        </li>
      </ul>
      <p>
        Berechtigungen folgen derselben Form: <code>&lt;domain&gt;:read</code> /{" "}
        <code>&lt;domain&gt;:write</code>, und innerhalb einer Domäne{" "}
        <strong>impliziert write read</strong>. Gerätlokaler Zustand
        (View-Präferenzen, Reader-Erscheinungsbild, Sync-Interna) und freies Rendering
        sind bewusst keine Plugin-Oberfläche — UI geht durch die deklarativen
        Ansichten unten.
      </p>

      <h2>Berechtigungen</h2>
      <p>
        Fähigkeitsgruppen auf <code>ctx</code> fehlen schlicht, solange ihre
        Berechtigung nicht deklariert ist — Gating auf API-Ebene gegen
        versehentliche Übergriffe. Namensraum-Speicher, UI-Beiträge,
        Session-Events und Reader-Navigation sind keine Berechtigungen; jedes
        Plugin hat sie.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Berechtigung</th>
              <th>Gewährt</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>shelf:read</code>
              </td>
              <td>
                <code>ctx.shelf</code> — Bücher (inkl. Inhaltsverzeichnis und
                Kapiteltext eines Buches), Sammlungen und Mitgliedschaft, sowie
                Lesestatistiken (<code>stats.forBook</code> /{" "}
                <code>stats.list</code> / <code>stats.overview</code> — Statistiken
                haben keine Schreibseite: ihre Events sind aufgezeichnete Fakten der
                Reader-Aktivität, keine Nutzerbefehle).
              </td>
            </tr>
            <tr>
              <td>
                <code>shelf:write</code>
              </td>
              <td>
                <code>ctx.shelf.books.write</code> — Dateien importieren, Metadaten
                bearbeiten, mit Stern markieren, als beendet markieren, entfernen;
                Inhaltsanbieter und virtuelle Bücher.{" "}
                <code>ctx.shelf.collections.write</code> — erstellen, umbenennen,
                entfernen, Bücher zuweisen.
              </td>
            </tr>
            <tr>
              <td>
                <code>annotations:read</code> / <code>annotations:write</code>
              </td>
              <td>
                <code>ctx.annotations</code> — Markierungen, Notizen und gestellte
                Fragen; erstellen, umfärben, bearbeiten und entfernen von Markierungen
                und Notizen (Fragen sind vom Agenten geschrieben, schreibgeschützt).
              </td>
            </tr>
            <tr>
              <td>
                <code>conversations:read</code>
              </td>
              <td>
                <code>ctx.conversations</code> — KI-Threads pro Buch und globale
                Threads (schreibgeschützt).
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:themes</code>
              </td>
              <td>
                Die deklarativen <code>themes</code> / <code>fonts</code>{" "}
                Manifest-Felder (unten) — App- und Reader-Themes mit gebündelten
                Schriften. Der einzige UI-Beitrag hinter einer Berechtigung: Er hat
                visuelle Autorität über die gesamte App, deshalb muss er bei der
                Installation offen zur Zustimmung stehen.
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:appearance</code>
              </td>
              <td>
                <code>ctx.appearance</code> — alle Themes auflisten, die beide
                Oberflächen anbieten, das aktuelle Erscheinungsbild lesen und
                App-Theme oder Seitenfarbe umschalten. Bewusst getrennt von{" "}
                <code>ui:themes</code>: ein Theme anzubieten ist passiv, eines
                umzuschalten nicht.
              </td>
            </tr>
            <tr>
              <td>
                <code>agent:tools</code>
              </td>
              <td>
                <code>ctx.agent.registerTool</code> — Werkzeuge für den
                Lese-Assistenten.
              </td>
            </tr>
            <tr>
              <td>
                <code>service:network</code>
              </td>
              <td>
                <code>ctx.network.fetch</code> — ausgehende HTTP über den nativen
                Client der App (keine CORS-Einschränkungen).
              </td>
            </tr>
            <tr>
              <td>
                <code>service:llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code> — einmalige Modellanrufe über das
                konfigurierte KI-Konto des Nutzers. Kein Thread, kein Gedächtnis,
                keine Werkzeuge;
                unterstützt strukturierte JSON-Ausgabe über <code>schema</code> und
                Streaming über <code>onText</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>service:clipboard</code>
              </td>
              <td>
                <code>ctx.clipboard.writeText</code>.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        (<code>reader:modes</code> — host-gerenderte geführte Lesemodi — ist derzeit
        für die gebündelten First-Party-Plugins reserviert, während dieser
        privilegierte Vertrag sich festigt.)
      </p>

      <h2>Contributions</h2>

      <h3>Auswahlaktionen</h3>
      <p>
        Einträge in den Auswahl- und Annotationsmenüs des Readers. Der Handler erhält
        den ausgewählten Text, seinen CFI-Bereich, das Kapitel und das Buch. Wenn
        verfügbar, enthält <code>context</code> die umgebende Passage. Innerhalb des
        Readers führt eine Aktion entweder still aus (gibt einen Toast zurück) oder
        öffnet einen Dialog (gibt eine Ansicht zurück) — das sind die einzigen beiden
        Ergebnisse. Deklariere <code>presentation: "dialog"</code>, wenn der
        Handler asynchron ist: Der Host öffnet sofort seine Ladeansicht und füllt
        sie mit dem Ergebnis, sobald <code>run</code> zurückkehrt. Eine
        Wörterbuch-artige Aktion kann <code>role: "lookup"</code> deklarieren; der
        Host leitet dann den bestehenden Tastaturbefehl fürs Nachschlagen an diese
        Plugin-Aktion um, statt einen zweiten eingebauten Nachschlage-Pfad zu
        pflegen.
      </p>
      <pre>
        <code>{`ctx.ui.registerSelectionAction({
  id: "save-quote",
  title: "Save quote",
  icon: "quotes",
  presentation: "dialog",
  run: (input) => {
    // input: { text, context?, cfiRange, chapterHref, book, source }
    return { toast: "Quote saved." };
  },
});`}</code>
      </pre>

      <h3>Kopfzeilenaktionen</h3>
      <p>
        Ein Icon-Button auf einer oberen Leiste. Auf der Reader-Oberfläche öffnet die
        Ansicht als verankertes Popover; auf dem Regal öffnet sie als Popover oder
        volle Seite, je nach <code>presentation</code>. Der Reader erlaubt niemals
        ganzseitige Unterbrechungen.
      </p>
      <pre>
        <code>{`ctx.ui.registerHeaderAction({
  id: "reading-report",
  title: "Reading report",
  icon: "chart-line-up",
  surface: "shelf",
  presentation: "page",
  view: async () => ({
    kind: "markdown",
    title: "This week",
    markdown: "You read **4h 12m** across 3 books.",
  }),
});`}</code>
      </pre>

      <h3>Befehle</h3>
      <p>
        Ein Befehlspaletten-Eintrag. Alle Plugin-Aktionen erscheinen auch automatisch
        in der Palette; explizite Befehle sind für Aktionen ohne Button.
      </p>
      <pre>
        <code>{`ctx.ui.registerCommand({
  id: "sync-now",
  title: "Anki Sync: sync now",
  run: async () => ({ toast: "Synced." }),
});`}</code>
      </pre>

      <h3>Agenten-Werkzeuge</h3>
      <p>
        Werkzeuge, die der Lese-Assistent während des Chats aufrufen kann (erfordert{" "}
        <code>agent:tools</code>). <code>parameters</code> ist einfaches JSON Schema
        für das Argument-Objekt; lass es weg für ein Werkzeug ohne Argumente.
        Werkzeuge bekommen den Namensraum{" "}
        <code>plugin_&lt;pluginId&gt;_&lt;name&gt;</code>, bevor sie das Modell
        erreichen, und Aufrufe sind im Chat als Werkzeug-Schritte sichtbar.
      </p>
      <pre>
        <code>{`ctx.agent?.registerTool({
  name: "search_deck",
  label: "Searching your Anki deck",
  description: "Search the user's Anki collection for a term.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async ({ query }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8765", {
      method: "POST",
      body: JSON.stringify({ action: "findNotes", query }),
    });
    return res.json();
  },
});`}</code>
      </pre>

      <h3>Stimmenanbieter</h3>
      <p>
        <code>ctx.audio.registerVoiceProvider</code> steckt eine
        Text-zu-Sprache-Engine in das Vorlesen des Readers. Das Plugin wandelt nur
        Text in kodierte Audio-Bytes um (mp3/wav — alles, was die Webview dekodiert);
        die App besitzt Wiedergabe, Satz-Taktung, Vorabruf und die
        Mitlauf-Hervorhebung. Die Registrierung braucht keine eigene Berechtigung —
        was immer der Anbieter zum Synthetisieren braucht (Netzwerk, Schlüssel), ist
        bereits durch seine anderen Berechtigungen gegated.
      </p>
      <pre>
        <code>{`ctx.audio.registerVoiceProvider({
  id: "voices",
  label: "My TTS",
  listVoices: () => [{ id: "default", label: "My TTS · warm" }],
  synthesize: async ({ text, voiceId }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8880/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: text, response_format: "mp3" }),
    });
    return res.arrayBuffer();
  },
});`}</code>
      </pre>
      <p>
        Eine registrierte Stimme wird automatisch übernommen — wer dein
        Plugin aktiviert, hat damit gewählt, es gibt keinen separaten hostseitigen
        Auswahldialog — und ein fehlgeschlagener Synthese-Aufruf fällt auf die
        Systemstimme für diesen Satz zurück, sodass das Lesen sich verschlechtert,
        anstatt still zu werden. Stimmen werden neu aufgelistet, wenn sich die
        Einstellungen des Plugins ändern.
      </p>

      <h3 id="scheduled-work">Geplante Arbeit</h3>
      <p>
        Das Manifest deklariert wiederkehrende Aufgaben; <code>activate</code> bindet
        die Arbeit. Die App führt jeden Zeitplan MINDESTENS alle{" "}
        <code>everyMinutes</code> aus (Mindestwert 15), während sie geöffnet ist,
        mit einem Aufhol-Lauf kurz nach dem Start, wenn überfällig — niemals zu
        exakten Zeiten und niemals, während die App geschlossen ist. Überlappende
        Durchläufe eines Zeitplans werden übersprungen; ein fehlgeschlagener Lauf
        wartet einfach auf die nächste Kadenz.
      </p>
      <pre>
        <code>{`// manifest.json
"schedules": [{ "id": "refresh", "label": "Refresh feeds", "everyMinutes": 60 }]

// main.js
ctx.schedule.on("refresh", async () => {
  // abrufen, abgleichen, über die Domänen-APIs schreiben
});`}</code>
      </pre>

      <h3 id="themes-and-bundled-fonts">Themes und gebündelte Schriften</h3>
      <p>
        Mit <code>ui:themes</code> kann das Manifest Themes für zwei unabhängige
        Einhängepunkte deklarieren — das App-Chrome und die Buchseite — plus
        Schriftdateien, die im Plugin-Ordner ausgeliefert werden. Dieser Beitrag ist
        reine Daten: Die App validiert jeden Wert und generiert alle CSS selbst, und
        nichts gilt, bis du das Theme unter Einstellungen → Darstellung oder
        über die Seitenfarben-Einstellung des Readers wählst. Die <code>main.js</code>{" "}
        eines Nur-Theme-Plugins ist nur{" "}
        <code>{"export default { activate() {} }"}</code>.
      </p>
      <pre>
        <code>{`{
  "permissions": ["ui:themes"],
  "fonts": [
    {
      "id": "my-serif",
      "family": "My Serif",
      "kind": "serif",
      "files": [{ "path": "assets/my-serif-400.woff2", "weight": 400 }]
    }
  ],
  "themes": [
    {
      "id": "dusk",
      "name": { "default": "Dusk", "translations": { "zh-Hans": "暮色" } },
      "polarity": "dark",
      "app": { "paper": "#14171e", "fg": "#e3e6ec" },
      "reader": {
        "palette": {
          "bg": "#161a22", "text": "#ccd2dd",
          "selection": "rgba(154, 162, 177, 0.28)",
          "rule": "rgba(204, 210, 221, 0.18)",
          "faint": "rgba(204, 210, 221, 0.07)",
          "muted": "rgba(204, 210, 221, 0.55)"
        },
        "typography": { "fontFamily": "plugin:my-serif", "fontSize": "large" }
      }
    }
  ]
}`}</code>
      </pre>
      <ul>
        <li>
          <code>polarity</code> — ob das Theme hell oder dunkel wirkt. Steuert{" "}
          <code>color-scheme</code>, die Polaritäts-Standardwerte für App-Token, die
          das Theme ungesetzt lässt, und wie die Auto-Seitenfarbe des Readers
          aufgelöst wird, während das Theme aktiv ist.
        </li>
        <li>
          <code>app</code> — Überschreibungen auf dem festen Token-Vokabular der App
          (Canvas, Text-Stufen, Oberflächen, Füllungen, Rahmen — siehe{" "}
          <code>PluginAppThemeTokens</code> in den Typings). Nicht gesetzte Token
          behalten die Werte der Polarität.
        </li>
        <li>
          <code>reader</code> — die gleiche Sechs-Farben-Palette, die die eingebauten
          Seitenfarben verwenden (alle sechs erforderlich), plus eine optionale
          Typografie-Voreinstellung, die einmal angewendet wird, wenn du das
          Theme wählst; danach kannst du alles anpassen.
        </li>
        <li>
          <code>fonts</code> — <code>.woff2</code>/<code>.woff</code>/
          <code>.ttf</code>/<code>.otf</code> Faces direkt aus dem Plugin-Ordner
          bereitgestellt; jede erscheint in der Schriftauswahl des Readers, solange
          das Plugin aktiviert ist. Ein Theme verweist auf seine eigenen
          Schriften als <code>plugin:&lt;fontId&gt;</code>. Marktplatz-Plugins müssen
          Schriftdateien im <code>files</code>-Feld des Registry-Eintrags auflisten.
        </li>
        <li>
          Farben werden gegen strenge Grammatiken validiert — einfaches Hex oder{" "}
          <code>rgb()</code>/<code>rgba()</code>/<code>hsl()</code>/
          <code>hsla()</code>; Schlüsselwörter, <code>var()</code> und{" "}
          <code>url()</code> werden abgelehnt.
        </li>
      </ul>

      <h2>Views</h2>
      <p>
        Plugins deklarieren einen Baum von Host-Komponenten; die App rendert jedes
        visuelle Primitiv und jedes Steuerelement. Plugins liefern niemals JSX, HTML,
        CSS oder Klassen.
      </p>
      <ul>
        <li>
          <code>markdown</code> — ein Markdown-String, von der App gesetzt.
        </li>
        <li>
          <code>list</code> — durchsuchbare Host-Listen mit festem Debounce,
          Keywords, Accessories und Empty States. <code>timeline</code> fügt Heute /
          Diese Woche / Diesen Monat / Alle Filter und lokale Datumsgruppen hinzu; ein
          Element kann <code>presentation: "dialog"</code> verwenden, um seine
          zurückgegebene Ansicht über der Liste zu zeigen, anstatt eine Unterseite zu
          pushen. Listen-Level-<code>actions</code> sind host-gerenderte Icon-Buttons;
          Timelines platzieren sie ganz rechts in der Tab-Reihe.
        </li>
        <li>
          <code>form</code> — Text-, Textarea-, Number-, Time-, Select-, Choice-, Checkbox-
          und Toggle-Steuerelemente aus der ReadAware-Komponentenbibliothek, plus{" "}
          <code>onSubmit</code>.
        </li>
        <li>
          <code>detail</code> — Raycast-artiger Primärinhalt, Metadaten und
          host-gerenderte Steuerelemente und Aktionen. Semantische
          Select-Steuerelemente bleiben beim Inhalts-Heading; Dialoge halten Herkunft,
          Daten und Tags in einer ruhigen Zeile darunter, während Aktionen neben dem
          Host-Schließen-Button in einem festen Footer sitzen.
        </li>
        <li>
          <code>blocks</code> — Host-Typografie, Markdown, Wörterbuchinhalt,
          Metadaten, Zitate, Aktionen, Metriken, Fortschritt, Tags, Alerts, Sections,
          Groups und responsive <code>columns</code>. Spalten bieten nur
          begrenzte Gewichte, Abstände, Mindestbreiten-Voreinstellungen und
          semantische Ausrichtung an. Exaktes CSS und Umbruch bleiben im Design-System;
          Deklarationen werden zur Laufzeit validiert und die Verschachtelung ist
          begrenzt.
        </li>
      </ul>
      <p>
        Handler (<code>run</code>, <code>onSelect</code>, <code>onSubmit</code>) geben
        alle dieselbe Ergebnisform zurück:
      </p>
      <ul>
        <li>
          nichts — die Oberfläche bleibt, wie sie ist;
        </li>
        <li>
          <code>{"{ toast: \"…\" }"}</code> — ein vorübergehender Hinweis;
        </li>
        <li>
          <code>{"{ view }"}</code> — öffnen oder auf die Oberfläche pushen;
        </li>
        <li>
          <code>{'{ view, navigation: "replace" | "reset" }'}</code> — die aktuelle
          Ansicht ersetzen oder zu einer neuen Root-Ansicht zurückkehren;
        </li>
        <li>
          <code>{"{ close: true }"}</code> — die Oberfläche schließen (komponierbar
          mit <code>toast</code>);
        </li>
        <li>
          <code>{"{ fieldErrors }"}</code> — von einem Formular-Submit: auf dem
          Formular bleiben und Fehler unter den Feldern zeigen.
        </li>
      </ul>
      <p>
        Asynchrone Arbeit ist unkompliziert: Gib ein Promise zurück, und die
        App zeigt den Ladezustand. Icons werden per Name aus dem kuratierten
        Phosphor-Set der App gewählt — kein eigenes SVG.
      </p>

      <h2>Domänendaten</h2>
      <p>
        Jeder gewährte Domänen-Namensraum bietet Lesevorgänge, kanonische
        Event-Abonnements und (mit der Schreibberechtigung) Befehle. Kurz gefasst:
      </p>
      <ul>
        <li>
          <code>ctx.shelf.books</code> — <code>list()</code>, <code>get(id)</code>,{" "}
          <code>getToc(id)</code>, <code>getChapterText(id, index)</code>;
          Schreibvorgänge: <code>import</code>, <code>editMetadata</code>,{" "}
          <code>setStarred</code>, <code>setFinished</code>, <code>remove</code>, plus
          Inhaltsanbieter (unten).
        </li>
        <li>
          <code>ctx.shelf.collections</code> — <code>list()</code>,{" "}
          <code>booksIn(id)</code>; Schreibvorgänge: <code>create</code>,{" "}
          <code>rename</code>, <code>remove</code>,{" "}
          <code>assignBooks(bookIds, collectionId | null)</code>.
        </li>
        <li>
          <code>ctx.shelf.stats</code> — <code>forBook(bookId)</code>,{" "}
          <code>list()</code>, <code>overview()</code> (Positionen, Status und aktive
          Lesezeit; schreibgeschützt für jeden Akteur).
        </li>
        <li>
          <code>ctx.annotations</code> —{" "}
          <code>list({"{ bookId?, kind?, query? }"})</code> gibt eine diskriminierte
          Union von Markierungen, Notizen und Fragen zurück; Schreibvorgänge:{" "}
          <code>createHighlight</code>, <code>recolorHighlight</code>,{" "}
          <code>removeHighlight</code>, <code>createNote</code>,{" "}
          <code>updateNote</code>, <code>removeNote</code>.
        </li>
        <li>
          <code>ctx.conversations</code> — <code>getBookThread(bookId)</code>,{" "}
          <code>listThreads()</code>, <code>getThread(id)</code>; abonnieren über{" "}
          <code>on</code> (<code>aiConversation.started</code>,{" "}
          <code>aiMessage.appended</code>, <code>aiMessage.removed</code>,{" "}
          <code>aiConversation.cleared</code>).
        </li>
      </ul>

      <h2>Events</h2>
      <p>
        Zwei Klassen, bewusst getrennt. <strong>Domänen-Events</strong> sind die
        Fakten, die die App aufzeichnet; abonniere sie pro Domäne, unter
        kanonischen Namen, mit der Leseberechtigung der Domäne. Jede Zustellung ist{" "}
        <code>{"{ type, payload, createdAt, origin }"}</code> — origin gibt an,
        welcher
        Software-Akteur das Faktum produziert hat (<code>user</code>,{" "}
        <code>agent</code>, <code>system</code> oder{" "}
        <code>plugin:&lt;id&gt;</code>).
      </p>
      <pre>
        <code>{`ctx.annotations?.on("highlight.created", ({ payload, origin }) => {
  // payload: { highlightId, bookId, text, color?, … }
});
ctx.shelf?.on("book.removed", ({ payload }) => { /* { bookId } */ });
`}</code>
      </pre>
      <p>
        <strong>Session-Fakten</strong> beschreiben, was gerade auf dem Bildschirm
        zu sehen ist.
        Sie gelangen niemals ins Event-Log und benötigen keine Berechtigung:{" "}
        <code>ctx.session.on(event, handler)</code>.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Session-Event</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>book-opened</code>
              </td>
              <td>
                <code>{"{ book: { id, title, author? } }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>book-closed</code>
              </td>
              <td>
                <code>{"{ bookId }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>chapter-changed</code>
              </td>
              <td>
                <code>{"{ bookId, chapterHref }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>reading-progress</code>
              </td>
              <td>
                <code>{"{ bookId, fraction }"}</code> — feuert bei Seitenwechseln,
                Anteil 0..1
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Inhaltsanbieter und virtuelle Bücher</h2>
      <p>
        Mit <code>shelf:write</code> kann ein Plugin echte Bücher auf das Regal
        stellen. <code>import</code> nimmt die Bytes einer Datei. Inhaltsanbieter
        überspringen die Datei vollständig: Registriere einen Anbieter, füge
        virtuelle Bücher hinzu, die an ihn gebunden sind, und liefere
        HTML-Abschnitte, sobald das Buch geöffnet wird. Der Reader paginiert,
        annotiert und verfolgt den Fortschritt auf ihnen wie bei jedem Buch — ein
        RSS-Feed als Buch ist genau das.
      </p>
      <pre>
        <code>{`ctx.shelf?.books.write?.registerContentProvider({
  id: "rss",
  async load(key) {
    const feed = await fetchFeed(key); // dein Code, über ctx.network.fetch
    return {
      title: feed.title,
      sections: feed.items.map((item) => ({
        title: item.title,
        html: item.contentHtml,
      })),
    };
  },
});

await ctx.shelf?.books.write?.addVirtualBook({
  providerId: "rss",
  key: "https://example.com/feed.xml",
  title: "Example Weekly",
});`}</code>
      </pre>

      <h2 id="storage-and-settings">Speicher und Einstellungen</h2>
      <p>
        <code>ctx.storage</code> ist ein Key-Value-Speicher im eigenen Namensraum,
        persistiert mit den lokalen Daten der App — <code>get</code>,{" "}
        <code>set</code>, <code>remove</code>. Wenn das Manifest{" "}
        <code>settings</code>-Felder deklariert, rendert die App sie als eigene
        Sektion des Plugins in den Einstellungen und die Werte kommen bei{" "}
        <code>ctx.storage.get("settings")</code> als ein Objekt an. Der
        Lese-Assistent kann diese Einstellungen auch einsehen und ändern (Felder, die
        mit <code>agentHidden</code> markiert sind, bleiben außer Sicht). Drei
        Feldfähigkeiten gehen über ein einfaches Formular hinaus:
      </p>
      <ul>
        <li>
          <code>visibleWhen: {"{ field, equals }"}</code> zeigt ein Feld nur, während
          ein anderes Feld einen der gegebenen Werte hält. Versteckte Felder behalten
          ihre gespeicherten Werte — ein Einstellungs-Objekt kann einen Wert pro
          Variante tragen (das TTS-Plugin hält auf diese Weise eine Stimme pro
          Anbieter).
        </li>
        <li>
          Ein <code>select</code> mit <code>dynamicOptions: true</code> löst seine
          Optionen zur Laufzeit auf: Binde die Quelle in <code>activate</code>{" "}
          mit{" "}
          <code>ctx.settings.provideOptions(fieldId, async (values) =&gt;
          [...])</code>. Wenn die Quelle nichts liefert (noch keine Anmeldedaten,
          Endpunkt nicht erreichbar), fällt das Feld auf freie Texteingabe zurück —
          die Auflistung ist ein Komfort, nie eine Hürde.
        </li>
        <li>
          <code>kind: "secret"</code> deklariert eine Anmeldeinformation: Die App
          rendert ein Passwort-Eingabefeld, das in den verschlüsselten Secret-Store
          schreibt — die Feld-ID IST der <code>ctx.secrets</code>-Schlüssel, den dein
          Code ausliest — niemals in einfache Einstellungen und niemals in den
          Katalog des Assistenten. Der gespeicherte Wert wird niemals angezeigt;
          das Feld zeigt einen konfigurierten Zustand und eine Möglichkeit zum
          Leeren.
        </li>
      </ul>
      <p>
        Für strukturierte Daten öffnet <code>ctx.storage.collection(name)</code> eine
        benannte Dokumenten-Sammlung — <code>put</code> / <code>get</code> /{" "}
        <code>delete</code> / <code>list</code> über pro-Dokument-Datensätze, mit
        optionaler <code>bookId</code> / <code>anchor</code>-Herkunft, nach der du
        filtern kannst. Herkunft ist ein Index, kein Eigentum: Dokumente überleben die
        Löschung des referenzierten Buches, und der Lebenszyklus der Sammlung gehört
        dem Plugin (Deinstallation löscht sie). Das eingebaute Wörterbuch-Plugin und
        seine gespeicherte-Wort-Timeline sind vollständig auf dieser Ebene aufgebaut.
      </p>

      <h2>Umgebender Kontext</h2>
      <p>Immer verfügbar, keine Berechtigung benötigt:</p>
      <ul>
        <li>
          <code>ctx.manifest</code>, <code>ctx.appVersion</code>,{" "}
          <code>ctx.locale</code> (das aktuelle BCP-47-Locale der App-UI — lies
          es zum Zeitpunkt der Verwendung, es folgt der Spracheinstellung live);
        </li>
        <li>
          <code>ctx.ui.showToast(message)</code>;
        </li>
        <li>
          <code>ctx.ui.exportFile({"{ filename, content, mimeType? }"})</code>{" "}
          öffnet den Speichern-Dialog des Hosts für generierten Text (CSV, JSON,
          Markdown) oder binäre Bytes;
        </li>
        <li>
          <code>ctx.secrets</code> — verschlüsselter Speicher für Anmeldedaten,
          pro Plugin unter eigenem Namensraum (API-Token und ähnliches); lebt
          außerhalb von SQLite und Backups und überlebt die Deinstallation;
        </li>
        <li>
          <code>ctx.session.on(…)</code> — die Session-Fakten oben;
        </li>
        <li>
          <code>ctx.reader.openBook(bookId)</code> und{" "}
          <code>ctx.reader.goTo({"{ bookId?, cfi?, href? }"})</code> — Reader-Navigation
          (für dich sichtbare Steuerung, keine Datenoffenlegung).
        </li>
      </ul>

      <h2>Stabilität</h2>
      <p>
        Dies ist Vertrag v2, ausgeliefert in App 0.3.0 — ein bewusster Neuaufbau
        mit Brüchen, der die gesamte Oberfläche aus dem Domänenmodell ableitet
        (v1-Manifeste scheitern bei der Installation mit einer lesbaren
        Fehlermeldung). Von hier wächst die API additiv: neue Domänen, neue
        Event-Namen, neue Block-Arten — deklarative Themes
        (<code>ui:themes</code>) sind die erste solche Ergänzung. Brechende
        Änderungen an dem, was hier dokumentiert ist, werden als Bugs
        behandelt. Deklariere <code>minAppVersion</code> für alles, was von einer
        neueren Ergänzung abhängt.
      </p>
    </article>
  );
}
