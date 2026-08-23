import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/fr/docs/plugins/develop")({
  head: () => ({
    meta: [
      { title: "Créer un plugin — Documentation ReadAware" },
      {
        name: "description",
        content:
          "Créez, validez, installez, migrez et testez un plugin ReadAware avec le modèle TypeScript public.",
      },
    ],
  }),
  component: DevelopPluginPage,
});

function DevelopPluginPage() {
  return (
    <article className="doc-prose">
      <h1>Créer un plugin</h1>
      <p className="lead">
        Partez du modèle TypeScript public, déclarez l’ensemble minimal de
        capacités et testez le paquet compilé dans l’application de bureau ReadAware ;
        l’hôte gère le cycle de vie, les permissions, la présentation et le retour arrière ;
        votre plugin gère son comportement et ses données privées.
      </p>

      <h2>Prérequis</h2>
      <ul>
        <li>ReadAware Desktop, avec accès à Paramètres → Plugins.</li>
        <li><a href="https://bun.sh" target="_blank" rel="noopener noreferrer">Bun</a> pour les scripts du dépôt.</li>
        <li>Un clone ou fork du{" "}
          <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">dépôt readaware-plugins</a>.
        </li>
      </ul>

      <h2>Créer le paquet</h2>
      <ol>
        <li>Copiez <code>template/</code> vers <code>plugins/&lt;your-plugin-id&gt;/</code>.</li>
        <li>Conservez le nom du dossier, l’identifiant du manifeste <code>id</code>, et l’espace de noms d’exécution identiques.</li>
        <li>Modifiez <code>manifest.json</code> et <code>src/main.ts</code>.</li>
        <li>Supprimez les contributions du modèle inutilisées et retirez leurs permissions.</li>
        <li>Construisez le fichier autonome <code>main.js</code> chargé par ReadAware.</li>
      </ol>
      <pre><code>{`bun run build
bun run typecheck
bun test
bun run validate`}</code></pre>

      <h2>Concevoir le manifeste avant l’implémentation</h2>
      <p>Examinez le manifeste dans cet ordre :</p>
      <ol>
        <li><strong>Identité</strong> — ID stable, nom, version du paquet, auteur et version minimale de l’application.</li>
        <li><strong>Données</strong> — entier positif <code>schemaVersion</code> et chemin de migration.</li>
        <li><strong>Compatibilité</strong> — plage semver dans <code>requires</code> pour chaque API et schéma utilisés.</li>
        <li><strong>Autorité</strong> — <code>permissions</code> sémantiques et accords <code>settingsAccess</code> exacts.</li>
        <li><strong>Déclarations</strong> — paramètres, tâches planifiées, thèmes, polices et module d’entrée.</li>
      </ol>
      <p>
        Utilisez le <Link to="/fr/docs/plugins/capabilities">navigateur des capacités et aperçu des permissions</Link>{" "}
        avant l’installation. Les exigences sont des déclarations de compatibilité, pas une
        autorité utilisateur ; les capacités sans permission doivent tout de même figurer dans{" "}
        <code>requires</code> lorsque votre plugin dépend de leur contrat.
      </p>

      <h2>Choisir la bonne capacité</h2>
      <ol>
        <li>Utilisez un <strong>Domaine</strong> pour l’état ou le comportement géré par ReadAware.</li>
        <li>Utilisez une <strong>Contribution</strong> pour fournir un choix, une action ou un fournisseur.</li>
        <li>Utilisez un <strong>Service</strong> pour une opération d’hôte limitée.</li>
        <li>Utilisez le stockage du plugin uniquement pour ses propres données.</li>
        <li>Demandez une nouvelle capacité d’hôte typée lorsqu’aucune forme existante ne convient.</li>
      </ol>
      <p>
        Ne recopiez pas les livres, la progression, les annotations, les réglages ou la mémoire
        dans le stockage du plugin. Un état miroir contourne les invariants du produit, les
        événements validés, la reconstruction des projections, la synchronisation et le contexte de l’agent.
      </p>

      <h2>Garder l’activation déclarative</h2>
      <p>
        Pendant <code>activate(ctx)</code>, inspectez l’environnement et enregistrez
        les actions, commandes, fournisseurs, abonnements et tâches planifiées. N’effectuez
        aucune écriture métier ni travail externe. L’hôte prépare chaque enregistrement
        jusqu’à la fin des RPC d’activation et à la réponse du Worker au ping de santé.
      </p>
      <p>
        Lancez le travail d’exécution depuis un gestionnaire enregistré après la promotion. Si un
        gestionnaire renvoie une promise, laissez l’hôte présenter les états de chargement et d’échec.
        Ne conservez des références vers des ressources externes que si votre <code>deactivate()</code>
        facultatif doit les fermer ; les enregistrements et abonnements de l’hôte sont libérés automatiquement.
      </p>

      <h2>Versionner explicitement les données privées</h2>
      <p>
        <code>schemaVersion</code> versionne le KV et les collections de documents du plugin ;
        il est indépendant de la version du paquet. Ne le modifiez que lorsque la structure des
        données privées change. Exportez <code>migrate(storageCtx, change)</code> pour chaque
        mise à niveau ou rétrogradation prise en charge après la validation d’un schéma.
      </p>
      <ul>
        <li>Les migrations ne reçoivent que le stockage : aucun domaine, réglage, secret, réseau, UI, LLM ou contribution.</li>
        <li>Rendez chaque transition déterministe et idempotente.</li>
        <li>Testez un échec après des écritures partielles ; l’hôte doit restaurer exactement le KV, les documents, les fichiers et les métadonnées de schéma.</li>
        <li>N’utilisez pas une vérification de version du paquet à la place du schéma de données.</li>
      </ul>

      <h2>Installer le dossier de travail</h2>
      <ol>
        <li>Lancez la compilation et les vérifications.</li>
        <li>Ouvrez ReadAware → Paramètres → Plugins → Installer un plugin.</li>
        <li>Sélectionnez le dossier compilé et examinez le résumé du consentement.</li>
        <li>Testez la fonctionnalité réelle dans l’application de bureau.</li>
        <li>Recompilez et réinstallez pour tester une mise à jour.</li>
      </ol>
      <p>
        Un navigateur ordinaire ne peut pas vérifier l’installation du plugin, l’IPC du Worker,
        la persistance SQLite, l’accès aux livres bruts, l’intégration au lecteur ou le retour arrière.
        Testez l’application Tauri livrée.
      </p>

      <h2>Tester le cycle de vie, pas seulement le cas nominal</h2>
      <ul>
        <li>Installation initiale, activation, désactivation et réactivation sans redémarrage.</li>
        <li>Mise à jour et rétrogradation réussies sur des données réelles.</li>
        <li>Délai d’activation, rejet du gestionnaire, échec de migration et retour arrière exact.</li>
        <li>Nettoyage à la désinstallation : aucune action, écoute, tâche, fournisseur ou Worker résiduel.</li>
        <li>Retrait et ajout de permissions lors d’une mise à jour.</li>
        <li>Libellés longs, états vides, navigation clavier et tous les thèmes de l’hôte.</li>
      </ul>

      <h2>Connaître les limites actuelles</h2>
      <p>
        Les tâches planifiées s’exécutent tant que ReadAware est ouvert, au moins selon leur
        cadence déclarée, avec rattrapage au lancement lorsqu’elles sont en retard. Ce ne sont
        pas des tâches durables : aucune exécution n’a lieu lorsque l’application est fermée et
        il n’existe ni file persistante, ni contrat de nouvelle tentative/recul, ni garantie de reprise après crash.
      </p>
      <p>
        L’UI n’est disponible qu’aux points de contribution typés existants. Un emplacement
        manquant nécessite une contribution et un consommateur gérés par l’hôte ; du HTML
        arbitraire ou une API native invoke générique ne sera pas ajouté comme raccourci.
      </p>

      <h2>Suite</h2>
      <p>
        Gardez la <Link to="/fr/docs/plugins/api">référence de l’API</Link> à côté de votre
        éditeur, puis lisez <Link to="/fr/docs/plugins/publishing">Publication</Link>{" "}
        avant de préparer une pull request pour le registre.
      </p>
    </article>
  );
}
