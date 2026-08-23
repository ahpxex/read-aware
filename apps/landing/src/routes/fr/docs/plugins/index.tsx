import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/fr/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "Système de plugins — Documentation ReadAware" },
      {
        name: "description",
        content:
          "Comment les plugins ReadAware étendent les domaines du produit, ajoutent des capacités, utilisent les services de l’hôte et restent dans des limites de confiance explicites.",
      },
    ],
  }),
  component: PluginsOverviewPage,
});

function PluginsOverviewPage() {
  return (
    <article className="doc-prose">
      <h1>Système de plugins</h1>
      <p className="lead">
        Les plugins ReadAware peuvent utiliser les données de lecture, ajouter des actions natives et
        des fournisseurs, étendre l’assistant de lecture et demander à l’hôte des
        services limités. Les paquets installés sont chargés dynamiquement ; l’application n’a jamais besoin d’un
        interrupteur pour chaque ID de plugin.
      </p>

      <h2>Un modèle, trois familles de capacités</h2>
      <p>
        Chaque capacité exécutable d’un plugin prend l’une de trois formes. Choisir
        la bonne forme est la première décision d’écriture.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr><th>Famille</th><th>À utiliser lorsque</th><th>Exemples</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Domaine</strong></td>
              <td>ReadAware possède déjà l’état ou le comportement.</td>
              <td>Bibliothèque, lecture, annotations, conversations, paramètres</td>
            </tr>
            <tr>
              <td><strong>Contribution</strong></td>
              <td>Le plugin fournit un nouveau choix ou une nouvelle implémentation.</td>
              <td>Actions, commandes, voix, contenu, thèmes, fournisseurs de l’agent</td>
            </tr>
            <tr>
              <td><strong>Service</strong></td>
              <td>L’hôte doit effectuer une opération externe limitée.</td>
              <td>Stockage, secrets, tâches planifiées, réseau, LLM, presse-papiers</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Les schémas déclaratifs de vues, paramètres et thèmes complètent ces
        familles. Ils décrivent des données rendues par l’hôte ; ils n’accordent aucune autre
        source d’autorité.
      </p>

      <h2>Les réglages sont un domaine</h2>
      <p>
        L’apparence est une section des réglages, et non une API de plugin distincte. Un plugin
        qui change le thème sélectionné demande des chemins de réglage précis tels que{" "}
        <code>appearance.theme</code>. Un plugin qui fournit un nouveau thème utilise
        la contribution <code>themes</code>. Choisir et fournir sont
        volontairement des pouvoirs distincts.
      </p>

      <h2>Ce que les plugins peuvent ajouter</h2>
      <ul>
        <li>Actions de sélection et d’en-tête, commandes de palette et vues rendues par l’hôte.</li>
        <li>Voix, fournisseurs de contenu de livres virtuels, modes de lecture, thèmes et polices.</li>
        <li>Outils d’agent, contexte par tour, sources privées consultables et candidats mémoire.</li>
        <li>Paramètres de plugin, options dynamiques, tâches récurrentes, stockage et secrets chiffrés.</li>
        <li>Lectures, commandes et abonnements aux événements validés dans les domaines accordés.</li>
      </ul>
      <p>
        Consultez la liste complète et versionnée dans le{" "}
        <Link to="/fr/docs/plugins/capabilities">navigateur des capacités</Link>. Il
        comprend également un aperçu des permissions pour <code>manifest.json</code>.
      </p>

      <h2>Interface native, par construction</h2>
      <p>
        Les plugins ne montent ni React, ni HTML, ni CSS, ni iframe ni DOM arbitraire. Ils
        renvoient des données de vue et callbacks validés ; ReadAware gère la mise en page,
        la navigation, l’accessibilité, la compatibilité des thèmes, les états de chargement et
        le nettoyage. Toute nouvelle liberté visuelle arrive sous forme de schéma limité ou de véritable point hôte
        de contribution, jamais comme échappatoire webview générique.
      </p>

      <h2>La limite de confiance</h2>
      <p>
        Chaque plugin s’exécute dans son propre Worker de module. Il n’a accès ni au DOM, ni à Tauri,
        ni à SQLite, ni au système de fichiers, ni à un descripteur de processus ; le réseau ambiant et les API de persistance du navigateur
        sont désactivés. Les appels de l’hôte traversent une frontière de messages et
        sont résolus selon la vue de capacités de l’acteur du plugin.
      </p>
      <p>
        Cela limite les dépassements accidentels et directs, mais l’installation reste
        une décision de confiance logicielle. Avant l’exécution du code, ReadAware affiche les
        permissions sémantiques et les accès précis aux réglages. Les exigences de capacités sont
        vérifiées séparément : la permission répond « peut-il le faire ? », tandis qu’une
        exigence de version répond « peut-il utiliser correctement ce contrat ? »
      </p>

      <h2>L’activation et les mises à jour sont transactionnelles</h2>
      <p>
        <code>activate()</code> est une phase de lecture et de déclaration. Les enregistrements restent
        invisibles pendant que l’hôte traite les appels et vérifie le Worker ;
        les écritures, secrets, réseau, LLM, presse-papiers, effets UI et navigation
        sont bloqués. Les changements persistants passent ensuite par un{" "}
        <code>migrate()</code>. Seul un candidat sain et migré est promu.
      </p>
      <p>
        Les mises à jour sauvegardent les fichiers, le KV du plugin, les collections de documents et les
        métadonnées de schéma validées. Une activation ou migration échouée restaure les
        fichiers et données précédents, puis redémarre l’ancien runtime si nécessaire.
      </p>

      <h2>Écosystème actuel</h2>
      <p>
        Les plugins distribués aujourd’hui sont intégrés ou développés par l’équipe : Dictionary,
        Editorial Themes, RSS Reader, Sentence Reader, TTS Voices et Theme
        Schedule. Le dépôt public{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins
        </a>{" "}
        contient le modèle d’écriture, les déclarations publiques, la validation et
        le registre du marché. Aucune API tierce historique n’est à préserver ;
        le contrat actuel constitue la référence.
      </p>

      <h2>Commencer à créer</h2>
      <p>
        Suivez <Link to="/fr/docs/plugins/develop">Créer un plugin</Link> pour la
        boucle locale, utilisez la <Link to="/fr/docs/plugins/api">référence de l’API</Link>{" "}
        pendant l’implémentation, puis lisez{" "}
        <Link to="/fr/docs/plugins/publishing">Publication</Link> avant de soumettre
        une modification au registre.
      </p>
    </article>
  );
}
