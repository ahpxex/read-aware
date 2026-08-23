import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/fr/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "Publier un plugin — Documentation ReadAware" },
      {
        name: "description",
        content:
          "Préparez, validez, faites réviser et soumettez un plugin ReadAware au dépôt public du registre.",
      },
    ],
  }),
  component: PublicationPage,
});

function PublicationPage() {
  return (
    <article className="doc-prose">
      <h1>Publier un plugin</h1>
      <p className="lead">
        Les paquets du registre sont hébergés dans le dépôt public{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins
        </a>{" "}
        et sont soumis à révision. Le catalogue actuel est composé de plugins développés par l’équipe ; ce
        processus constitue également le contrat d’ouverture aux soumissions externes.
      </p>

      <h2>Préparer un paquet révisable</h2>
      <p>
        TypeScript est recommandé. Conservez <code>src/</code> à côté du fichier
        autonome compilé <code>main.js</code> afin que les réviseurs puissent comparer le
        code source et l’artefact. Ajoutez chaque ressource d’exécution au dépôt. Ne chargez pas
        de code distant, ne dissimulez pas le comportement dans des fichiers générés et ne dépendez
        pas de fichiers situés en dehors du paquet.
      </p>
      <pre><code>{`plugins/my-plugin/
  manifest.json
  main.js
  package.json
  tsconfig.json
  src/main.ts
  assets/…`}</code></pre>

      <h2>Exécuter les vérifications du dépôt</h2>
      <pre><code>{`bun run build
bun run typecheck
bun test
bun run validate`}</code></pre>
      <p>
        La validation vérifie la cohérence entre le registre et le manifeste, les ID, les versions,
        les exigences de capacités, les permissions, les fichiers déclarés et la structure du paquet.
        Ces vérifications sont nécessaires, mais ne suffisent pas : testez le dossier compilé dans
        ReadAware Desktop avant de le soumettre.
      </p>

      <h2>Soumettre</h2>
      <ol>
        <li>Créez un fork du dépôt public.</li>
        <li>Copiez le modèle dans <code>plugins/&lt;plugin-id&gt;/</code> et faites correspondre le nom du dossier à l’ID du manifeste.</li>
        <li>Ajoutez le paquet et chaque ressource d’exécution requise.</li>
        <li>Ajoutez l’entrée correspondante, triée par ID, dans <code>registry.json</code>.</li>
        <li>Exécutez les quatre vérifications à la racine du dépôt et testez l’installation locale depuis le dossier compilé.</li>
        <li>Ouvrez une pull request décrivant le comportement, les données privées, les services externes et la raison de chaque permission et accès aux réglages.</li>
      </ol>

      <h2>Liste de contrôle de la révision</h2>
      <ul>
        <li>La fonctionnalité utilise les capacités Domaine, Contribution et Service existantes les plus ciblées.</li>
        <li><code>requires</code> mentionne chaque contrat utilisé avec une plage semver justifiable.</li>
        <li>Les permissions et <code>settingsAccess</code> correspondent aux appels réels du runtime et ne contiennent aucune autorité spéculative.</li>
        <li><code>activate()</code> enregistre le comportement, mais n’effectue aucun effet de bord métier ou externe.</li>
        <li>Les données privées du plugin ont un schéma stable et chaque transition de version possède une migration testée.</li>
        <li>Les points d’accès réseau, l’utilisation du LLM, les identifiants, les tâches planifiées et la conservation des données sont expliqués dans un langage destiné aux utilisateurs.</li>
        <li>Les vues rendues par l’hôte fonctionnent avec la navigation clavier, les textes longs, les données vides et les thèmes clairs et sombres.</li>
        <li>Le code source est lisible, la sortie générée est reproductible et aucun outil d’analyse, suivi, procédé d’obfuscation ou chargement de code distant n’est présent.</li>
      </ul>
      <p>
        L’<Link to="/fr/docs/plugins/capabilities">aperçu des permissions</Link> constitue une
        vérification préalable utile. La validation du dépôt et la révision humaine restent les
        contrôles faisant autorité.
      </p>

      <h2>Mises à jour et migration des données</h2>
      <p>
        Incrémentez la version du paquet dans <code>manifest.json</code> et{" "}
        <code>registry.json</code>. Incrémentez <code>schemaVersion</code> uniquement lorsque
        la structure du KV privé ou des documents change, et fournissez le <code>migrate()</code>
        correspondant dans le même candidat.
      </p>
      <p>
        Testez la mise à jour et la rétrogradation volontaire avec des données réalistes. ReadAware
        met le candidat en attente et vérifie sa santé, prend un instantané des fichiers et des données du plugin,
        met l’ancien runtime au repos pour la migration et ne promeut le candidat qu’après sa réussite.
        Une mise à jour échouée doit laisser le paquet et les données précédents utilisables.
      </p>

      <h2>Modifications des permissions</h2>
      <p>
        Traitez toute nouvelle autorité comme une évolution du produit, et non comme un simple
        entretien du manifeste. Expliquez pourquoi l’ensemble de permissions précédent est insuffisant,
        quelles données utilisateur ou opérations externes deviennent accessibles et ce qui se passe
        lorsque l’utilisateur refuse. Supprimez les permissions que le code n’utilise plus.
      </p>

      <h2>Confiance dans la distribution actuelle</h2>
      <p>
        L’isolation du Worker et l’application des capacités limitent les dépassements, mais
        l’installation reste une décision de confiance. Avant d’ouvrir largement le registre à des tiers,
        ReadAware doit encore disposer d’une identité des éditeurs, d’un empaquetage déterministe,
        de la signature et de la vérification d’intégrité, de la provenance des révisions, de la
        révocation, d’une revue des différences de permissions et d’une procédure de réponse aux incidents.
      </p>
      <p>
        Tant que ces contrôles ne sont pas disponibles, une entrée fusionnée dans le dépôt constitue
        une preuve de révision, et non une garantie mathématique que du code hostile arbitraire est sûr.
      </p>

      <h2>Avant d’ouvrir la pull request</h2>
      <p>
        Relisez <Link to="/fr/docs/plugins/develop">Créer un plugin</Link>, comparez
        le manifeste final à l’aide des{" "}
        <Link to="/fr/docs/plugins/capabilities">outils de capacités</Link> et
        vérifiez que le paquet suit le <Link to="/fr/docs/plugins/api">contrat d’API</Link> actuel,
        plutôt qu’un exemple ancien utilisant <code>shelf</code> ou <code>appearance</code>.
      </p>
    </article>
  );
}
