import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/fr/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "Publication et distribution — Documentation ReadAware" },
      {
        name: "description",
        content:
          "Comment soumettre une extension au marché d'extensions ReadAware : structure du dépôt, processus de validation et exigences de révision.",
      },
    ],
  }),
  component: PublishingPage,
});

function PublishingPage() {
  return (
    <article className="doc-prose">
      <h1>Publier une extension</h1>
      <p className="lead">
        Le marché d'extensions fonctionne comme le dépôt d'extensions de Raycast : votre extension
        vit dans le dépôt public{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins
        </a>
        , entrant par pull request. Une fois fusionné, elle apparaît dans « Réglages → Extensions
        → Marché d'extensions » de l'application, installable en un clic.
      </p>

      <h2>Écrire en TypeScript</h2>
      <p>
        TypeScript est recommandé. Le dépôt est livré avec un <code>template/</code>, déjà
        connecté à l'API typée (<code>types/plugin-api.d.ts</code>) — copiez-le, écrivez{" "}
        <code>src/main.ts</code>, puis construisez en un seul module autonome :
      </p>
      <pre>
        <code>bun build src/main.ts --outfile main.js --format esm</code>
      </pre>
      <p>
        Ce qui est soumis au marketplace est toujours le <code>main.js</code> construit ; gardez
        les commits de <code>src/</code> pour que les réviseurs puissent lire le vrai code.
        JavaScript pur est également accepté. Les extensions officielles dans <code>plugins/</code>{" "}
        sont écrites ainsi — traitez-les comme des exemples vivants.
      </p>

      <h2>Soumettre</h2>
      <ol>
        <li>Forkez le dépôt.</li>
        <li>
          Copiez <code>template/</code> en <code>plugins/&lt;your-plugin-id&gt;/</code>, au
          minimum <code>manifest.json</code> et <code>main.js</code>. Le nom du dossier doit
          correspondre à l'<code>id</code> du manifest.
        </li>
        <li>
          Ajoutez l'entrée correspondante dans <code>registry.json</code>, en gardant le tableau
          trié par id.
        </li>
        <li>
          Exécutez localement les mêmes vérifications que la CI :
          <pre>
            <code>{`node scripts/validate.mjs
npx tsc --noEmit`}</code>
          </pre>
        </li>
        <li>
          Ouvrez une pull request, expliquant ce que fait l'extension et pourquoi chaque
          permission déclarée est nécessaire.
        </li>
      </ol>
      <p>
        La CI applique la cohérence registre-manifest, le format d'id, la liste blanche de
        permissions et l'existence des fichiers, et vérifie le type de chaque extension TypeScript.
      </p>

      <h2>Mettre à jour</h2>
      <p>
        Même flux : augmentez <code>version</code> dans <code>manifest.json</code> et{" "}
        <code>registry.json</code> dans la même pull request. Notez que l'application lit le
        registre via CDN, donc les mises à jour fusionnées peuvent prendre un certain temps pour
        apparaître dans l'onglet marché d'extensions.
      </p>

      <h2>Exigences de révision</h2>
      <ul>
        <li>
          Ne déclarez que les permissions minimales. Les permissions déclarées au-delà de
          l'utilisation réelle du code feront échouer la pull request — voir le{" "}
          <Link to="/fr/docs/plugins/api">tableau des permissions</Link>.
        </li>
        <li>
          <code>main.js</code> doit être lisible, ou livré avec les sources qui le construisent.
        </li>
        <li>Pas de code obscurci, pas d'analytics ou de tracking, pas de chargement de code distant.</li>
      </ul>
      <p>
        Les extensions s'exécutent à l'intérieur de l'application, avec la même capacité d'accès
        que l'application elle-même. L'installation est une décision de confiance que l'utilisateur
        prend pour chaque extension individuellement, et cette révision est la première ligne de
        défense de la communauté — écrivez le genre d'extension que vous installeriez vous-même
        d'un étranger.
      </p>
    </article>
  );
}
