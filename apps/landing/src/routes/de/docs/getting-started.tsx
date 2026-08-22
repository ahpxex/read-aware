import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/de/docs/getting-started")({
  head: () => ({
    meta: [
      { title: "Erste Schritte — ReadAware Dokumentation" },
      {
        name: "description",
        content:
          "Bücher importieren, lesen und annotieren, einen KI-Anbieter verbinden und erfahren, wo deine Daten liegen.",
      },
    ],
  }),
  component: GettingStartedPage,
});

function GettingStartedPage() {
  return (
    <article className="doc-prose">
      <h1>Erste Schritte</h1>
      <p className="lead">
        ReadAware öffnet deine eigenen Dateien und bewahrt alles, was es lernt,
        auf deinem Gerät auf. Diese Seite führt durch die erste Stunde: Bücher
        importieren, lesen und annotieren und — optional — eine KI verbinden.
      </p>

      <h2>Füge deine Bücher hinzu</h2>
      <p>
        Importiere Dateien über das Regal — oder überspring die Schaltfläche
        ganz: Leg Buchdateien irgendwo ins Fenster, oder mach ReadAware zur
        Standard-App für deine Buchformate und doppelklicke sie im
        Dateimanager — das Buch öffnet sich direkt im Reader und wird auf dem
        Weg dorthin ins Regal aufgenommen. ReadAware liest{" "}
        <strong>EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML und PDF</strong>{" "}
        direkt — es gibt keinen Konvertierungsschritt und keinen Cloud-Upload.
        Die Datei, die du importierst, ist die Datei, die du behältst;
        Markierungen, Notizen und deine Leseposition hängen am Originaltext.
      </p>
      <p>
        DRM-geschützte Dateien lassen sich nicht öffnen — ein Buch, das bei
        einem Store gekauft wurde, der seine Dateien sperrt, bleibt gesperrt.
        Wenn sich ein Buch nicht öffnen lässt und das Format unterstützt wird,
        liegt es fast immer daran.
      </p>

      <h2>Lesen</h2>
      <p>
        Jedes Format öffnet sich im selben Reader mit denselben
        Bedienelementen. Drei Lesemodi stehen in den Darstellungseinstellungen
        des Readers bereit:
      </p>
      <ul>
        <li>
          <strong>Kontinuierlicher Scroll</strong> — die Standardeinstellung;
          das Buch fließt als eine Spalte.
        </li>
        <li>
          <strong>Einzelseite</strong> — eine Seite nach der anderen, umgeblättert
          wie Papier.
        </li>
        <li>
          <strong>Doppelseite</strong> — ein buchartiger Aufschlag auf breiten
          Bildschirmen.
        </li>
      </ul>
      <p>
        Deine Position wird pro Buch gespeichert, und das Inhaltsverzeichnis
        ist in der Kopfleiste des Readers immer nur einen Klick entfernt.
      </p>
      <p>
        Dieselben Darstellungseinstellungen steuern die Typografie: Schrift,
        Größe, Strichstärke, Zeilenabstand, Absatzabstand, Ränder und
        Seitenfarbe. Die Textausrichtung steht standardmäßig auf{" "}
        <strong>Wie veröffentlicht</strong> — genau das, was das Stylesheet des
        Buches verlangt — und lässt sich auf linksbündig oder Blocksatz
        erzwingen, wenn du es lieber überall einheitlich hättest.
      </p>
      <p>
        Bücher mit festem Layout — PDFs und Comics — sind Seiten, die jemand
        anderes bereits gesetzt hat; es gibt in ihnen keine Typografie zu
        ändern, und diese Bedienelemente werden ausgeblendet. Die Seitenfarbe
        greift weiterhin: Eine helle tönt das Papier beim Zeichnen der Seite
        und lässt jede Tinte und jedes Foto wie gedruckt aussehen, eine
        dunkle baut die
        Seite in zwei Tönen neu auf, damit der Text lesbar bleibt. Setze die{" "}
        <strong>Seitenwiedergabe</strong> auf <strong>Original</strong>, um ein
        Buch auf seinen eigenen Farben zu lassen — pro Buch gemerkt, für Kunst
        und Fotografie, wo die Farbe die Hauptsache ist.
      </p>

      <h2>Zuhören</h2>
      <p>
        Jedes Buch kann vorgelesen werden. Das Vorlesen reitet auf demselben
        Satz- und Absatz-Navigator, mit dem du liest — starte den Navigator,
        drück dann Play in seiner Leiste, und das Buch rückt Einheit für
        Einheit vor, wobei der gesprochene Text fortlaufend markiert wird.
      </p>
      <p>
        Standardmäßig spricht dies mit der eigenen Stimme deines Geräts, die
        keinen Schlüssel und kein Netzwerk braucht. Ein Sprach-Plugin zu
        aktivieren — das mitgelieferte <strong>TTS Voices</strong>-Plugin oder
        jedes andere — ist selbst die Entscheidung, stattdessen über diese
        Engine zu sprechen; welche Stimme läuft, stellst du in den eigenen
        Einstellungen des Plugins ein, zusammen mit Anbieter und eventuellem
        eigenen Endpunkt. Es gibt keinen separaten Sprachwahldialog, der im
        Sync gehalten werden müsste.
      </p>

      <h2>Annotieren</h2>
      <p>Wähle eine Passage aus, und ein dezentes Aktionsmenü erscheint:</p>
      <ul>
        <li>
          <strong>Markieren</strong> — in einigen Farben oder als
          Unterstreichung.
        </li>
        <li>
          <strong>Notiz</strong> — deine eigenen Worte an die Passage heften.
        </li>
        <li>
          <strong>Nachschlagen</strong> — das eingebaute Wörterbuch erklärt das
          Wort in seinem Satz, nicht nur abstrakt, und speichert es in der
          Wörterbuch-Timeline. (Nutzt deine konfigurierte KI.)
        </li>
      </ul>
      <p>
        Alles, was du markierst, wird pro Buch gesammelt und speist das
        Gedächtnis der App — Annotationen sind kein Archiv, sie sind Material,
        das der Assistent liest.
      </p>

      <h2>Eine KI verbinden</h2>
      <p>
        Die gesamte Intelligenz von ReadAware läuft auf einem Schlüssel, den du
        selbst mitbringst. Lesen, Annotieren und die Bibliothek funktionieren
        vollständig ohne einen; der Assistent, das Wörterbuch und das
        Gedächtnis brauchen ihn.
      </p>
      <ol>
        <li>Öffne Einstellungen → KI.</li>
        <li>
          Wähle einen Anbieter — OpenAI, Anthropic, Google, OpenRouter,
          DeepSeek, xAI, Groq, Mistral, Moonshot, Z.ai oder jeden
          OpenAI-kompatiblen Endpunkt über <strong>Benutzerdefiniert</strong>.
        </li>
        <li>Füge deinen API-Schlüssel ein und wähle ein Modell.</li>
      </ol>
      <p>
        ReadAware unterscheidet ein <strong>Smart</strong>-Modell (Chat und
        Synthese) von einem <strong>Fast</strong>-Modell
        (Wörterbuch-Nachschlagen, Zusammenfassungen, Gedächtnispflege);
        vernünftige Standardwerte sind pro Anbieter vorausgefüllt. Dein
        Schlüssel liegt auf deinem Gerät, und Anfragen gehen direkt an deinen
        Anbieter — es gibt keinen ReadAware-Server dazwischen.
      </p>

      <h2>Fragen</h2>
      <p>
        Jedes Buch hat eine dauerhafte Unterhaltung — öffne das Chat-Panel beim
        Lesen und frag nach der Passage, dem Kapitel oder dem Buch. Auf der{" "}
        <strong>Kontext</strong>-Seite kannst du über dein ganzes Regal hinweg
        in beliebig vielen Threads sprechen.
      </p>
      <p>
        Der Assistent arbeitet aus deiner Lektüre: deine Markierungen, Notizen,
        früheren Gespräche und ein Langzeitgedächtnis, das er darüber pflegt,
        was du liest und was dir wichtig ist. Dieses Gedächtnis wird lokal
        aufgebaut und gespeichert — wie alles andere auch.
      </p>

      <h2>Schnell vorankommen</h2>
      <p>
        Die Befehlspalette (<code>Cmd K</code> auf macOS, <code>Ctrl K</code>{" "}
        überall sonst — in den Einstellungen neu belegbar) erreicht jede
        Aktion: Bücher öffnen, Ansichten wechseln, Plugin-Befehle ausführen.
      </p>

      <h2>Wo deine Daten liegen</h2>
      <p>
        Bücher, Annotationen, Gespräche und Gedächtnis liegen auf deinem
        Gerät. Das Netzwerk wird für KI-Anfragen an deinen eigenen Anbieter
        genutzt — und, wenn du ein Sync-Konto verbindest, für ein
        Ende-zu-Ende-verschlüsseltes Relay, das deine Bibliothek über Geräte
        hinweg synchron hält. Die App bleibt in beiden Fällen vollständig
        offline nutzbar.
      </p>
      <p>
        Sync hält sich beim Arbeiten zurück: Seinen Fortschritt siehst du unter
        Einstellungen → Daten &amp; Sync, und das Hauptfenster meldet sich nur,
        wenn etwas scheitert — eine dezente Fehlermeldung, die du für einen Tag
        stummschalten kannst.
      </p>
    </article>
  );
}
