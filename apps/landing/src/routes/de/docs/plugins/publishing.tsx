import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/de/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "Ein Plugin veröffentlichen — ReadAware Dokumentation" },
      {
        name: "description",
        content:
          "Wie du ein Plugin beim ReadAware-Marktplatz einreichst: Repository-Aufbau, Validierung und die Erwartungen der Review.",
      },
    ],
  }),
  component: PublishingPage,
});

function PublishingPage() {
  return (
    <article className="doc-prose">
      <h1>Ein Plugin veröffentlichen</h1>
      <p className="lead">
        Der Marktplatz funktioniert wie Raycasts Erweiterungs-Repository: Dein
        Plugin lebt im öffentlichen Repository{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins
        </a>{" "}
        und kommt per Pull Request hinein. Nach dem Merge erscheint es in der
        App unter Einstellungen → Plugins → Marktplatz und installiert sich mit
        einem Klick.
      </p>

      <h2>In TypeScript schreiben</h2>
      <p>
        TypeScript ist der empfohlene Weg. Das Repository bringt ein{" "}
        <code>template/</code> mit, in dem die getypte API
        (<code>types/plugin-api.d.ts</code>) bereits verdrahtet ist — kopiere
        es, schreibe <code>src/main.ts</code> und baue ein einzelnes,
        in sich geschlossenes Modul:
      </p>
      <pre>
        <code>bun build src/main.ts --outfile main.js --format esm</code>
      </pre>
      <p>
        Was ausgeliefert wird, ist immer die gebaute <code>main.js</code>;
        committe <code>src/</code> mit, damit Reviewer den echten Code lesen
        können. Pures JavaScript ist genauso willkommen. Die offiziellen
        Plugins in <code>plugins/</code> sind so geschrieben — nimm sie als
        lebende Beispiele.
      </p>

      <h2>Einreichen</h2>
      <ol>
        <li>Forke das Repository.</li>
        <li>
          Kopiere <code>template/</code> nach{" "}
          <code>plugins/&lt;your-plugin-id&gt;/</code> mit mindestens{" "}
          <code>manifest.json</code> und <code>main.js</code>. Der Ordnername
          muss der <code>id</code> im Manifest entsprechen.
        </li>
        <li>
          Füge den passenden Eintrag in <code>registry.json</code> hinzu und
          halte das Array nach id sortiert.
        </li>
        <li>
          Führe dieselben Prüfungen aus, die CI laufen lässt:
          <pre>
            <code>{`node scripts/validate.mjs
npx tsc --noEmit`}</code>
          </pre>
        </li>
        <li>
          Öffne eine Pull Request, die beschreibt, was das Plugin tut und
          warum es jede deklarierte Berechtigung braucht.
        </li>
      </ol>
      <p>
        CI erzwingt die Konsistenz von Registry und Manifest, die Form der id,
        die Berechtigungs-Whitelist und die Existenz der Dateien — und
        type-checkt jedes TypeScript-Plugin.
      </p>

      <h2>Updates</h2>
      <p>
        Derselbe Ablauf: Erhöhe <code>version</code> in{" "}
        <code>manifest.json</code> und <code>registry.json</code> in einer
        Pull Request. Beachte, dass die App die Registry über ein CDN liest —
        ein gemergtes Update kann also einen Moment brauchen, bis es im
        Marktplatz-Tab erscheint.
      </p>

      <h2>Erwartungen der Review</h2>
      <ul>
        <li>
          Deklariere nur die minimalen Berechtigungen. Pull Requests, die mehr
          verlangen, als der Code nutzt, gehen zurück — siehe die{" "}
          <Link to="/de/docs/plugins/api">Berechtigungstabelle</Link>.
        </li>
        <li>
          <code>main.js</code> muss lesbar sein oder zusammen mit dem Quellcode
          kommen, aus dem gebündelt wurde.
        </li>
        <li>
          Kein verschleierter Code, keine Analytics oder Trackings, kein
          Nachladen von Code aus dem Netz.
        </li>
      </ul>
      <p>
        Plugins laufen innerhalb der App mit demselben Zugriff wie die App
        selbst. Die Installation ist eine Vertrauensentscheidung, die Nutzer
        pro Plugin treffen, und diese Review ist die erste Verteidigungslinie
        der Community — schreibe Plugins, die du selbst bedenkenlos bei einem
        Fremden installieren würdest.
      </p>
    </article>
  );
}
