import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/de/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "Plugin-System — ReadAware Dokumentation" },
      {
        name: "description",
        content:
          "Was ReadAware-Plugins leisten können, wie das Vertrauensmodell funktioniert und wie man sie installiert.",
      },
    ],
  }),
  component: PluginsOverviewPage,
});

function PluginsOverviewPage() {
  return (
    <article className="doc-prose">
      <h1>Plugin-System</h1>
      <p className="lead">
        Plugins erweitern ReadAware mit neuen Aktionen, neuen Seiten und — am
        wichtigsten — neuen Werkzeugen für den Lese-Assistenten. Ein Plugin ist
        ein kleines JavaScript-Modul; seine Oberfläche wird immer vom eigenen
        Design-System der App gerendert, sodass Plugin-Features nativ aussehen
        und sich so anfühlen.
      </p>

      <h2>Was ein Plugin beitragen kann</h2>
      <ul>
        <li>
          <strong>Auswahlaktionen</strong> — Einträge im Textauswahl-Menü des
          Readers. Ein Wort an Anki senden, eine Passage übersetzen, ein Zitat
          irgendwo speichern.
        </li>
        <li>
          <strong>Kopfleisten-Buttons</strong> — Icon-Buttons in der Kopfleiste
          des Readers oder Regals, die ein Popover öffnen — oder beim Regal
          eine ganze Seite.
        </li>
        <li>
          <strong>Befehle</strong> — Einträge in der Befehlspalette. Jede
          Plugin-Aktion ist dort automatisch erreichbar; explizite Befehle
          fügen weitere hinzu.
        </li>
        <li>
          <strong>Agenten-Werkzeuge</strong> — Funktionen, die der
          Lese-Assistent während des Chats aufrufen kann. Dies ist der
          Erweiterungspunkt mit dem größten Potenzial: Ein Plugin kann dem
          Assistenten erlauben, dein Anki-Deck, deinen RSS-Backlog oder jeden
          Dienst, den du nutzt, abzufragen.
        </li>
        <li>
          <strong>Inhaltsanbieter</strong> — virtuelle Bücher, deren Kapitel
          das Plugin auf Anfrage liefert. Ein RSS-Feed kann auf deinem Regal
          stehen und wie jedes Buch gelesen, annotiert und besprochen werden.
        </li>
        <li>
          <strong>Vorlesestimmen</strong> — TTS-Engines für das Vorlesen des
          Readers. Das Plugin synthetisiert Audio; die App besitzt die
          Wiedergabe und fällt bei einem fehlgeschlagenen Aufruf auf die
          Systemstimme zurück.
        </li>
        <li>
          <strong>Einstellungen und Zeitpläne</strong> — deklarierte
          Einstellungen werden zur eigenen Sektion des Plugins in den
          Einstellungen (API-Schlüssel inklusive, verschlüsselt gespeichert),
          und deklarierte Zeitpläne führen wiederkehrende Arbeit aus, während
          die App offen ist.
        </li>
      </ul>

      <h2>Plugins wirken systembedingt nativ</h2>
      <p>
        Plugins rendern niemals eigenes HTML. Sie deklarieren Ansichten aus
        einem kleinen Vokabular — Markdown, Listen, Formulare und ein paar
        strukturierte Blöcke — und die App rendert sie mit ihren eigenen
        Komponenten. Plugin-Autoren geben die Kontrolle über Pixel auf und
        bekommen dafür null Design-Arbeit und eine dauerhaft konsistente App.
      </p>

      <h2>Das Vertrauensmodell</h2>
      <p>
        Plugins laufen innerhalb der App im selben JavaScript-Kontext — wie
        Obsidian, und anders als in einer Browser-Erweiterungs-Sandbox. Zwei
        ehrliche Schutzebenen greifen:
      </p>
      <ul>
        <li>
          <strong>Berechtigungen</strong> — das Manifest eines Plugins
          deklariert, was es benutzt (Netzwerk, Lesedaten, KI,
          Zwischenablage, …), und die API legt nur frei, was deklariert
          wurde. Das schützt vor versehentlichen Übergriffen.
        </li>
        <li>
          <strong>Die Installation ist die Vertrauensentscheidung.</strong>{" "}
          Bevor irgendetwas kopiert oder ausgeführt wird, zeigt die App in
          einfacher Sprache genau, welche Berechtigungen das Plugin verlangt,
          und wartet auf deine Zustimmung. Installiere Plugins so, wie du
          Software installieren würdest.
        </li>
      </ul>
      <p>
        Die Architektur der App begrenzt den Schaden: Der Plugin-Speicher liegt
        unter eigenem Namensraum im Datenverzeichnis der App, und die
        Desktop-Shell gewährt keinen beliebigen Dateisystemzugriff.
      </p>

      <h2>Plugins installieren</h2>
      <ul>
        <li>
          <strong>Marktplatz</strong> — Einstellungen → Plugins → Marktplatz
          listet Community-Plugins aus der öffentlichen{" "}
          <a
            href={MARKETPLACE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Registry
          </a>
          ; die Installation ist ein Klick — die Berechtigungsübersicht kommt
          zuerst.
        </li>
        <li>
          <strong>Aus einem Ordner</strong> — Einstellungen → Plugins
          installiert jeden lokalen Plugin-Ordner. Das ist der
          Entwicklungs-Loop: Zeig auf dein Arbeitsverzeichnis und installiere
          neu, um Änderungen zu übernehmen.
        </li>
      </ul>

      <h2>Du bestimmst das Layout</h2>
      <p>
        Plugins bringen Fähigkeiten mit; du entscheidest, wo Buttons leben.
        Einstellungen → Anpassen ordnet jede Oberfläche (Regal-Kopfleiste,
        Reader-Kopfleiste, Auswahlmenü): Zieh Einträge zwischen der sichtbaren
        Reihe und dem Überlaufmenü hin und her, sortiere sie um oder setze sie
        auf die Standardwerte zurück. Neue Plugin-Aktionen landen leise im
        Überlaufmenü — und alles ist immer über die Befehlspalette erreichbar.
      </p>

      <h2 id="read-aloud-tts">Vorlesen mit jeder TTS-Stimme</h2>
      <p>
        Das mitgelieferte <strong>TTS Voices</strong>-Plugin leitet das
        Vorlesen durch die Engine deiner Wahl — ElevenLabs, Fish Audio, OpenAI
        oder jeden OpenAI-kompatiblen Endpunkt (Kokoro, LocalAI, Edge
        TTS-Bridges…). Alles lebt in{" "}
        <strong>Einstellungen → TTS Voices</strong>: Wähle einen Anbieter, und
        seine Felder erscheinen — API-Schlüssel gehen direkt in den
        verschlüsselten Secret-Store, und wo der Anbieter Stimmen aufzählen
        kann, wird das Stimmen-Feld zur Liste (trage sonst selbst einen Namen
        ein).
      </p>
      <p>
        Ein beliebtes kostenloses Setup sind Microsofts Edge-Neural-Stimmen
        über{" "}
        <a
          href="https://github.com/travisvn/openai-edge-tts"
          target="_blank"
          rel="noopener noreferrer"
        >
          openai-edge-tts
        </a>
        , ein kleiner lokaler Server, der die OpenAI-Audio-API spricht:
      </p>
      <ol>
        <li>
          Führe den Server lokal aus — zum Beispiel{" "}
          <code>docker run -d -p 5050:5050 travisvn/openai-edge-tts</code>
          (standardmäßig ohne API-Schlüssel).
        </li>
        <li>
          Setze in Einstellungen → TTS Voices den Anbieter auf{" "}
          <em>Benutzerdefiniert / lokal (OpenAI-kompatibel)</em> und den
          Endpunkt auf{" "}
          <code>http://127.0.0.1:5050/v1/audio/speech</code>.
        </li>
        <li>
          Wähle eine Stimme aus der Liste — die App liest den Katalog des
          Servers, sodass das vollständige Edge-Set (z. B.{" "}
          <code>zh-CN-XiaoxiaoNeural</code>,{" "}
          <code>en-US-AriaNeural</code>) neben den OpenAI-Stil-Aliasen
          erscheint.
        </li>
      </ol>
      <p>
        Öffne dann ein Buch und starte das Vorlesen: Sätze streamen durch die
        gewählte Stimme, der nächste wird vorgeladen, während der aktuelle
        läuft, und jeder fehlgeschlagene Aufruf fällt auf die Systemstimme
        zurück, statt das Lesen zu stoppen.
      </p>

      <h2>Ein Plugin schreiben</h2>
      <p>
        Ein Plugin ist ein Ordner mit einer <code>manifest.json</code> und
        einer einzigen <code>main.js</code>. Die{" "}
        <Link to="/de/docs/plugins/api">API-Referenz</Link> deckt den ganzen
        Vertrag ab, und{" "}
        <Link to="/de/docs/plugins/publishing">Veröffentlichen</Link> zeigt,
        wie du es in den Marktplatz bringst.
      </p>
    </article>
  );
}
