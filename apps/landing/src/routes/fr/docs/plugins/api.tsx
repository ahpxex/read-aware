import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/fr/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "Référence de l’API des plugins — Documentation ReadAware" },
      {
        name: "description",
        content:
          "Contrat actuel des plugins ReadAware : manifeste, capacités, domaines, contributions, services, interface déclarative, cycle de vie et migrations.",
      },
    ],
  }),
  component: PluginApiPage,
});

function PluginApiPage() {
  return (
    <article className="doc-prose">
      <h1>Référence de l’API des plugins</h1>
      <p className="lead">
        Un plugin est un dossier contenant <code>manifest.json</code> et un module ES compilé.
        Le contrat TypeScript public exact est fourni avec{" "}
        <code>types/plugin-api.d.ts</code>  dans le{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          dépôt readaware-plugins
        </a>. Cette page explique comment ses éléments s’articulent.
      </p>

      <h2>Structure du paquet</h2>
      <pre><code>{`my-plugin/
  manifest.json
  main.js
  src/main.ts       # recommended and committed for review
  assets/           # optional, explicitly listed for marketplace installs`}</code></pre>
      <p>
        <code>main.js</code> exporte par défaut un objet de cycle de vie. ReadAware l’exécute
        dans un Worker de module dédié et fournit à <code>activate</code> un
        contexte limité à l’acteur.
      </p>
      <pre><code>{`export default {
  activate(ctx) {
    // Inspect and register. Side effects are blocked in this phase.
  },
  migrate(storageCtx, change) {
    // Optional: transform plugin-private KV and documents.
  },
  deactivate() {
    // Optional: release the plugin's own external resources.
  },
};`}</code></pre>

      <h2>Manifeste</h2>
      <pre><code>{`{
  "id": "theme-schedule",
  "name": "Planification des thèmes",
  "version": "0.1.0",
  "schemaVersion": 1,
  "minAppVersion": "0.3.0",
  "requires": {
    "domains": { "settings": "^1.0.0" },
    "contributions": {
      "commands": "^1.0.0",
      "settingsOptions": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "ui": "^1.0.0"
    },
    "schemas": { "settings": "^1.0.0" }
  },
  "settingsAccess": {
    "discover": ["appearance.theme", "reading.theme"],
    "write": ["appearance.theme", "reading.theme"]
  },
  "main": "main.js"
}`}</code></pre>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Champ</th><th>Contrat</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>Lettres minuscules, chiffres et traits d’union ; 64 caractères maximum. Il s’agit de l’espace de noms permanent et il doit correspondre au nom du dossier.</td></tr>
            <tr><td><code>name</code>, <code>version</code></td><td>Nom visible par l’utilisateur et version du paquet.</td></tr>
            <tr><td><code>schemaVersion</code></td><td>Entier positif requis pour les données KV et documents privés du plugin. Indépendant de la version du paquet.</td></tr>
            <tr><td><code>requires</code></td><td>Tableau requis associant les ID de capacités à des plages semver, regroupées par domaines, contributions, services et schémas.</td></tr>
            <tr><td><code>permissions</code></td><td>Autorité sémantique facultative demandée à l’utilisateur. Les valeurs inconnues échouent à la validation.</td></tr>
            <tr><td><code>settingsAccess</code></td><td>Accords facultatifs de découverte/lecture/écriture pour des chemins de paramètres exacts ou des groupes <code>section.*</code> explicites.</td></tr>
            <tr><td><code>minAppVersion</code></td><td>Version minimale facultative de l’application. À utiliser lorsque le paquet dépend d’une capacité récemment publiée.</td></tr>
            <tr><td><code>settings</code></td><td>Champs de paramètres du plugin rendus par l’hôte.</td></tr>
            <tr><td><code>schedules</code></td><td>Tâches récurrentes facultatives, déclarées avant la liaison de leurs gestionnaires.</td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>Contributions déclaratives facultatives de thèmes et de polices ; nécessite <code>ui:themes</code>.</td></tr>
            <tr><td><code>main</code></td><td>Module d’entrée relatif au dossier ; prend par défaut la valeur <code>main.js</code>.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Utilisez le <Link to="/fr/docs/plugins/capabilities">navigateur des capacités</Link>{" "}
        pour consulter la liste complète et le vocabulaire des permissions. Une exigence
        est toujours une déclaration de compatibilité ; elle n’accorde jamais d’autorité.
      </p>

      <h2>Contexte d’exécution</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Espace de noms</th><th>Contient</th></tr></thead>
          <tbody>
            <tr><td><code>ctx.manifest</code></td><td>Le manifeste validé, en lecture seule.</td></tr>
            <tr><td><code>ctx.appVersion</code>, <code>ctx.locale</code></td><td>Version de l’hôte et langue actuelle de l’interface.</td></tr>
            <tr><td><code>ctx.lifecycle.phase</code></td><td><code>activating</code>, <code>migrating</code> ou <code>active</code>.</td></tr>
            <tr><td><code>ctx.capabilities</code></td><td>Uniquement les versions de capacités visibles pour cet acteur de plugin.</td></tr>
            <tr><td><code>ctx.domains</code></td><td>État et comportement ReadAware accordés.</td></tr>
            <tr><td><code>ctx.contributions</code></td><td>Registres auxquels le plugin peut fournir des implémentations.</td></tr>
            <tr><td><code>ctx.services</code></td><td>Opérations d’hôte limitées et infrastructure privée du plugin.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Les espaces de noms protégés par permission sont absents lorsqu’ils ne sont pas accordés. Chaque appel
        du Worker est également autorisé côté hôte ; masquer une méthode n’est pas le seul
        contrôle. Les enregistrements renvoient un objet libérable et sont récupérés dans l’ordre inverse
        lorsque l’activation échoue ou que le plugin est désactivé.
      </p>

      <h2>Domaines</h2>
      <p>
        Un domaine expose <code>queries</code>, éventuellement <code>commands</code>,
        et <code>events.subscribe</code> pour les événements validés. Les commandes
        utilisent le même chemin d’écriture piloté par les événements que ReadAware et sont
        attribuées à <code>plugin:&lt;id&gt;</code>. La permission d’écriture implique celle de lecture.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Domaine</th><th>Requêtes et commandes</th><th>Autorité</th></tr></thead>
          <tbody>
            <tr>
              <td><code>library</code></td>
              <td>Livres, métadonnées, texte source des chapitres, table des matières, collections ; commandes d’importation, de modification, de mise en favori, de suppression, de livres virtuels et de collections.</td>
              <td><code>library:read</code> / <code>library:write</code></td>
            </tr>
            <tr>
              <td><code>reading</code></td>
              <td>Statistiques de lecture par livre et agrégées ; marquer un livre comme terminé, ouvrir un livre et naviguer vers un CFI ou un href.</td>
              <td><code>reading:read</code> / <code>reading:write</code></td>
            </tr>
            <tr>
              <td><code>annotations</code></td>
              <td>Filtrer les surlignages, notes et traces de questions passives ; créer, modifier, recolorer et supprimer des surlignages ou des notes.</td>
              <td><code>annotations:read</code> / <code>annotations:write</code></td>
            </tr>
            <tr>
              <td><code>conversations</code></td>
              <td>Lire les fils de discussion de livres, lister les fils globaux et lire un fil. Les écritures restent dans le moteur de chat.</td>
              <td><code>conversations:read</code></td>
            </tr>
            <tr>
              <td><code>settings</code></td>
              <td>Découvrir les entrées de catalogue autorisées, lire les valeurs résolues, mettre à jour les cibles prises en charge et s’abonner aux changements validés.</td>
              <td>Accords <code>settingsAccess</code> exacts</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Il n’existe aucun domaine <code>shelf</code> ou <code>appearance</code>.
        Les données de bibliothèque et le comportement de lecture actif sont séparés. Appearance est une
        section des réglages.
      </p>

      <h3>Accès aux paramètres</h3>
      <p>
        <code>discover</code>, <code>read</code> et <code>write</code> sont
        indépendants. Accordez des chemins exacts lorsque possible ; utilisez un groupe de section
        tel que <code>appearance.*</code> uniquement lorsque la fonctionnalité a réellement besoin
        de toute la section. Les mises à jour passent par la validation du catalogue, la politique de cible,
        la persistance et les effets postérieurs à la validation.
      </p>
      <pre><code>{`const entries = await ctx.domains.settings.queries.discover({
  section: "appearance",
});

await ctx.domains.settings.commands.update([
  {
    path: "appearance.theme",
    value: "dark",
    target: { kind: "global" },
  },
]);`}</code></pre>

      <h2>Contributions</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Registre</th><th>Le plugin fournit</th><th>Permission</th></tr></thead>
          <tbody>
            <tr><td><code>selectionActions</code></td><td>Action de sélection et gestionnaire renvoyant une notification ou une vue rendue par l’hôte.</td><td>Aucun</td></tr>
            <tr><td><code>headerActions</code></td><td>Action de lecture ou de bibliothèque, métadonnées de placement et callback de vue.</td><td>Aucun</td></tr>
            <tr><td><code>commands</code></td><td>Métadonnées de commande et gestionnaire.</td><td>Aucun</td></tr>
            <tr><td><code>settingsOptions</code></td><td>Options dynamiques pour un champ de plugin déclaré.</td><td>Aucun</td></tr>
            <tr><td><code>voiceProviders</code></td><td>Liste de voix et synthèse audio encodée.</td><td>Aucun</td></tr>
            <tr><td><code>contentProviders</code></td><td>Sections pour une clé de livre virtuel.</td><td>Aucun</td></tr>
            <tr><td><code>readerModes</code></td><td>Mode de segmentation de lecture limité ; actuellement réservé aux plugins intégrés.</td><td><code>reader:modes</code></td></tr>
            <tr><td><code>agentTools</code></td><td>Schéma d’outil, libellé lisible, description et exécuteur.</td><td><code>agent:tools</code></td></tr>
            <tr><td><code>agentContextProviders</code></td><td>Blocs de référence limités pour le tour en cours.</td><td><code>agent:context</code></td></tr>
            <tr><td><code>agentRetrievalProviders</code></td><td>Résultats de recherche issus des données du plugin.</td><td><code>agent:retrieval</code></td></tr>
            <tr><td><code>memoryCandidateProviders</code></td><td>Faits, préférences, informations ou résumés potentiellement durables.</td><td><code>agent:memory</code></td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>Données sémantiques de thèmes et de polices déclarées dans le manifeste.</td><td><code>ui:themes</code></td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Chaque ID de contribution est limité à l’espace de noms du plugin ; chaque enregistrement est
        détenu et inspectable, et les objets libérables obsolètes ne peuvent pas supprimer un remplacement
        plus récent. Un nouveau type de contribution nécessite toujours un consommateur hôte conçu à cet effet ;
        ensuite, tout plugin compatible peut s’enregistrer sans être nommé par l’application.
      </p>

      <h3>Limites d’extension de l’agent</h3>
      <ul>
        <li><strong>Les fournisseurs de contexte</strong> s’exécutent pendant un tour. L’hôte ajoute la provenance, limite la taille et sérialise la sortie comme donnée de référence non fiable.</li>
        <li><strong>Les fournisseurs de recherche</strong> deviennent des outils dans l’espace de noms du plugin, avec un schéma <code>query</code>/<code>limit</code> géré par l’hôte et des résultats tronqués.</li>
        <li><strong>Les fournisseurs de candidats mémoire</strong> proposent des candidats limités après un tour ; l’hôte en vérifie la portée, les déduplique et effectue toute écriture durable.</li>
      </ul>
      <p>
        Les plugins ne reçoivent jamais le port de mémoire, ne peuvent pas injecter de règles système
        et ne peuvent pas écrire directement dans la mémoire à long terme.
      </p>

      <h2>Services de l’hôte</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Service</th><th>Contrat</th><th>Permission</th></tr></thead>
          <tbody>
            <tr><td><code>storage</code></td><td>KV dans un espace de noms, collections de documents et notifications de changements externes.</td><td>Aucun</td></tr>
            <tr><td><code>secrets</code></td><td>Emplacements d’identifiants chiffrés dans un espace de noms.</td><td>Aucun</td></tr>
            <tr><td><code>ui</code></td><td>Notification de l’hôte et flux d’enregistrement/exportation.</td><td>Aucun</td></tr>
            <tr><td><code>schedules</code></td><td>Lier un gestionnaire à une cadence déclarée dans le manifeste.</td><td>Aucun</td></tr>
            <tr><td><code>session</code></td><td>S’abonner à des informations limitées sur la session de lecture.</td><td>Aucun</td></tr>
            <tr><td><code>network</code></td><td>HTTP médié par l’hôte.</td><td><code>service:network</code></td></tr>
            <tr><td><code>llm</code></td><td>Appels ponctuels du modèle produisant du texte ou respectant un schéma JSON, avec la configuration de l’utilisateur.</td><td><code>service:llm</code></td></tr>
            <tr><td><code>clipboard</code></td><td>Écrire du texte dans le presse-papiers du système.</td><td><code>service:clipboard</code></td></tr>
          </tbody>
        </table>
      </div>

      <h3>Stockage</h3>
      <p>
        Utilisez KV pour les petits paramètres et points de contrôle. Utilisez une collection de documents
        nommée pour les enregistrements détenus par le plugin, avec des ID stables et une provenance
        facultative <code>bookId</code>/<code>anchor</code>. La provenance est un
        index, pas une propriété ; un document peut survivre à la suppression du livre référencé.
        La désinstallation vide les collections de documents, mais conserve le KV, les emplacements
        de secrets et les métadonnées de schéma validées pour la réinstallation et la migration.
      </p>

      <h3>Tâches planifiées</h3>
      <p>
        Le manifeste déclare <code>{`{ id, label, everyMinutes }`}</code> et
        l’activation lie le gestionnaire via{" "}
        <code>ctx.services.schedules.bind</code>. La cadence minimale est de 15
        minutes. Les exécutions ont lieu au moins à cette cadence lorsque l’application est ouverte,
        rattrapent leur retard au lancement et ne se chevauchent pas. Il ne s’agit pas d’une
        tâche d’arrière-plan durable ni d’une garantie d’exécution à une heure exacte.
      </p>

      <h2>Interface déclarative et paramètres</h2>
      <p>
        Les plugins renvoient des données de vue versionnées, pas une UI exécutable. La grammaire des vues
        comprend du markdown, des listes consultables, des formulaires, des mises en page détaillées,
        des résultats de dictionnaire et des arbres de blocs limités. Les gestionnaires peuvent conserver
        la surface, afficher une notification, ouvrir ou remplacer une vue, réinitialiser la navigation,
        fermer la surface ou renvoyer des erreurs de champs. L’hôte gère les états de chargement et d’échec
        des promesses.
      </p>
      <p>
        Les paramètres du manifeste utilisent les contrôles de l’hôte pour les champs texte, zone de texte,
        nombre, heure, sélection, choix, case à cocher, bascule et secret. Les champs conditionnels
        utilisent <code>visibleWhen</code> ; les sélections dynamiques utilisent un fournisseur{" "}
        <code>settingsOptions</code> enregistré. Les champs secrets écrivent directement dans les
        emplacements de secrets chiffrés et n’entrent jamais dans l’objet de paramètres ordinaire
        ni dans le catalogue visible par l’agent.
      </p>

      <h2>Thèmes et polices</h2>
      <p>
        Les plugins de thème déclarent des données sémantiques dans le manifeste. Un thème d’application
        remplace un vocabulaire fixe de jetons de l’hôte ; un thème de lecture fournit la palette de page
        obligatoire à six couleurs et des valeurs typographiques facultatives. L’hôte valide les valeurs,
        génère le CSS, charge les fichiers de polices locaux approuvés et n’applique rien tant que
        l’utilisateur ne l’a pas sélectionné.
      </p>
      <p>
        Fournir des choix nécessite <code>ui:themes</code>. En sélectionner un nécessite un
        accès précis en écriture à un réglage tel que <code>appearance.theme</code> ou{" "}
        <code>reading.theme</code>. L’un n’implique pas l’autre.
      </p>

      <h2>Phases du cycle de vie</h2>
      <ol>
        <li><strong>Activation :</strong> les requêtes et lectures privées du plugin sont disponibles ; les enregistrements sont mis en attente ; les effets de bord sont bloqués.</li>
        <li><strong>Migration :</strong> seuls le KV du plugin et les collections de documents sont disponibles.</li>
        <li><strong>Actif :</strong> les gestionnaires promus peuvent utiliser leurs domaines, contributions et services accordés.</li>
      </ol>
      <p>
        L’hôte traite les RPC d’activation, vérifie le Worker et exécute toute
        migration, puis promeut l’ensemble mis en attente à un point explicite unique.
        Une activation échouée libère le travail mis en attente sans remplacer le runtime actuel.
      </p>

      <h2>Environnement du Worker</h2>
      <p>
        Il n’existe aucun accès à React, Jotai, au DOM, à WebView, Tauri, SQLite, au système de fichiers
        ou aux processus. Les API ambiantes <code>fetch</code>, WebSocket, EventSource,
        XMLHttpRequest, BroadcastChannel, IndexedDB et Cache Storage sont désactivées. Utilisez le
        contexte typé pour le réseau, la persistance et chaque interaction avec l’hôte.
      </p>

      <h2>Compatibilité et stabilité</h2>
      <p>
        Les domaines, contributions, services et schémas déclaratifs portent chacun une version
        sémantique indépendante. Les ID inconnus, les plages semver invalides, les capacités requises
        inaccessibles et les versions d’hôte incompatibles empêchent l’activation. Les ajouts compatibles
        incrémentent la capacité concernée, et non un numéro global unique de l’API des plugins.
      </p>
      <p>
        L’écosystème actuel est propriétaire ; le contrat actuel adossé au registre
        constitue la référence. Ne vous appuyez pas sur les anciennes formes <code>shelf</code>,{" "}
        <code>appearance</code> ou antérieures au registre.
      </p>
    </article>
  );
}
