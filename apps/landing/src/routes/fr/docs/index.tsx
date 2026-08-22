import { Link, createFileRoute } from "@tanstack/react-router";
import { REPO_URL } from "../../../lib/releases";
import { DISCORD_URL } from "../../../lib/site";

export const Route = createFileRoute("/fr/docs/")({
  head: () => ({
    meta: [
      { title: "Documentation — ReadAware" },
      {
        name: "description",
        content:
          "Comment installer ReadAware, commencer à lire et étendre l'application avec des extensions.",
      },
    ],
  }),
  component: DocsOverview,
});

function DocsOverview() {
  return (
    <article className="doc-prose">
      <h1>Documentation</h1>
      <p className="lead">
        ReadAware est une application de lecture native IA : ouvrez
        EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML et PDF dans le même lecteur, et
        laissez-la bâtir une mémoire continue à partir de vos livres, surlignages et conversations.
        Elle est gratuite, locale d'abord, et utilise votre propre clé IA.
      </p>

      <h2>Premiers pas</h2>
      <ul>
        <li>
          <Link to="/fr/docs/install">Téléchargement et installation</Link> — les paquets pour
          macOS, Windows, Linux et Android, et comment procéder quand le système signale une
          application non signée.
        </li>
        <li>
          <Link to="/fr/docs/getting-started">Démarrage rapide</Link>
          — importer des livres, lire et annoter, connecter un fournisseur IA, et savoir où
          vivent vos données.
        </li>
      </ul>

      <h2>Étendre l'application</h2>
      <ul>
        <li>
          <Link to="/fr/docs/plugins">Système d'extensions</Link>
          — ce que les extensions peuvent faire, et comment fonctionne le modèle de confiance.
        </li>
        <li>
          <Link to="/fr/docs/plugins/api">Référence de l'API</Link>
          — le contrat complet pour écrire une extension : manifest, cycle de vie, permissions,
          points de contribution et vues.
        </li>
        <li>
          <Link to="/fr/docs/plugins/publishing">Publication et distribution</Link>
          — comment soumettre votre extension au marché d'extensions intégré à l'application.
        </li>
      </ul>

      <h2>Aller plus loin</h2>
      <p>
        Cette application est développée publiquement sur{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . Questions, signalements de bugs, ou votre propre création : rejoignez-nous sur{" "}
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Discord
        </a>{" "}
        ou ouvrez une issue.
      </p>
    </article>
  );
}
