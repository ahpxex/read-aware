import { createFileRoute } from "@tanstack/react-router";
import {
  PluginCapabilityBrowser,
  type PluginCapabilityBrowserCopy,
} from "../../../../components/PluginCapabilityBrowser";
import {
  PluginPermissionPreview,
  type PluginPermissionPreviewCopy,
} from "../../../../components/PluginPermissionPreview";

export const Route = createFileRoute("/fr/docs/plugins/capabilities")({
  head: () => ({
    meta: [
      { title: "Capacités des plugins — Documentation ReadAware" },
      {
        name: "description",
        content:
          "Parcourez chaque capacité versionnée des plugins ReadAware et prévisualisez l’autorité demandée par un manifeste de plugin.",
      },
    ],
  }),
  component: PluginCapabilitiesPage,
});

const capabilityCopy: PluginCapabilityBrowserCopy = {
  searchLabel: "Rechercher des capacités",
  searchPlaceholder: "ID, autorisation ou usage",
  familyLabel: "Famille de capacités",
  authorityLabel: "Type d’autorité",
  allFamilies: "Toutes les familles",
  allAuthorities: "Toutes les autorités",
  familyNames: {
    domains: "Domaines",
    contributions: "Contributions",
    services: "Services",
    schemas: "Schémas",
  },
  authorityNames: {
    permission: "Permission requise",
    "permission-free": "Aucune permission supplémentaire",
    "settings-grant": "Accès précis aux réglages",
  },
  permissionFree: "aucune",
  versionLabel: "v",
  permissionLabel: "Autorité",
  capabilityLabel: "Capacité",
  purposeLabel: "Le plugin peut",
  hostOwnsLabel: "L’hôte conserve",
  result: (count) => `${count} ${count === 1 ? "capacité" : "capacités"}`,
  noResults: "Aucune capacité ne correspond à ces filtres.",
  descriptions: {
    "domains:library": {
      purpose: "Lire des livres, fichiers, métadonnées, sommaires et collections, et importer ou supprimer des éléments de bibliothèque.",
      hostOwns: "Invariants de bibliothèque, écritures événementielles, fichiers et projections.",
    },
    "domains:reading": {
      purpose: "Inspecter la session active, naviguer et mettre à jour la position, la progression et le temps de lecture.",
      hostOwns: "Cycle de vie du lecteur, sémantique de progression et événements validés.",
    },
    "domains:annotations": {
      purpose: "Lire ou modifier les surlignages et les notes au moyen des commandes canoniques.",
      hostOwns: "Validation, attribution, persistance et ordre des événements.",
    },
    "domains:conversations": {
      purpose: "Lire les résumés des fils de discussion de livres et des fils globaux.",
      hostOwns: "Écritures des conversations, assemblage des prompts et mémoire.",
    },
    "domains:settings": {
      purpose: "Découvrir, lire, mettre à jour et suivre les chemins de paramètres explicitement accordés.",
      hostOwns: "Catalogue, cibles, validation, persistance et effets des changements.",
    },
    "contributions:selectionActions": {
      purpose: "Ajouter une commande aux menus de sélection et d’annotation.",
      hostOwns: "Placement dans les menus, interface d’appel, chargement et accessibilité.",
    },
    "contributions:headerActions": {
      purpose: "Ajouter une action à la barre du lecteur ou de la bibliothèque avec une vue rendue par l’hôte.",
      hostOwns: "Placement, navigation, fenêtres contextuelles, pages et focus.",
    },
    "contributions:commands": {
      purpose: "Ajouter une commande explicite à la palette de commandes.",
      hostOwns: "Registre, palette, raccourcis et présentation des résultats.",
    },
    "contributions:settingsOptions": {
      purpose: "Résoudre les options dynamiques d’un paramètre de plugin déclaré.",
      hostOwns: "Rendu du formulaire, saisie de secours et validation des valeurs.",
    },
    "contributions:voiceProviders": {
      purpose: "Lister les voix et synthétiser de l’audio encodé pour la lecture à voix haute.",
      hostOwns: "Lecture, rythme, préchargement, surlignage et solution de repli.",
    },
    "contributions:contentProviders": {
      purpose: "Charger des sections pour des livres virtuels tels que les flux RSS.",
      hostOwns: "Liaison à la bibliothèque, modèle de lecture, navigation et présentation.",
    },
    "contributions:readerModes": {
      purpose: "Fournir une segmentation limitée par phrase ou paragraphe. Actuellement réservé aux plugins intégrés.",
      hostOwns: "Commandes du lecteur, cycle de vie, rendu et navigation.",
    },
    "contributions:agentTools": {
      purpose: "Enregistrer un outil avec espace de noms que l’assistant de lecture peut appeler.",
      hostOwns: "Orchestration, visibilité des outils, approbations et interface de transcription.",
    },
    "contributions:agentContextProviders": {
      purpose: "Renvoyer des blocs de référence limités pour le tour utilisateur courant.",
      hostOwns: "Provenance, limitation, placement dans le prompt et durée de vie.",
    },
    "contributions:agentRetrievalProviders": {
      purpose: "Exposer une source du plugin consultable comme outil d’agent avec espace de noms.",
      hostOwns: "Schéma de requête, limites, limitation des résultats et description de l’outil.",
    },
    "contributions:memoryCandidateProviders": {
      purpose: "Proposer des faits, préférences, informations ou résumés après un tour.",
      hostOwns: "Vérification de portée, déduplication, acceptation et écritures mémoire durables.",
    },
    "contributions:themes": {
      purpose: "Fournir les données sémantiques des thèmes de l’application et du lecteur.",
      hostOwns: "Validation, génération CSS, sélection et application.",
    },
    "contributions:fonts": {
      purpose: "Fournir des métadonnées de polices approuvées et des fichiers de polices intégrés.",
      hostOwns: "Validation des fichiers, chargement, entrées du sélecteur et sélection active.",
    },
    "services:storage": {
      purpose: "Utiliser le KV et les collections de documents du plugin.",
      hostOwns: "Isolation par espace de noms, persistance, instantanés et événements de changement.",
    },
    "services:secrets": {
      purpose: "Stocker et récupérer des identifiants dans les emplacements secrets du plugin.",
      hostOwns: "Chiffrement, non-divulgation et isolation par espace de noms.",
    },
    "services:ui": {
      purpose: "Afficher une notification de l’hôte ou ouvrir le flux d’enregistrement/exportation.",
      hostOwns: "Présentation, choix du chemin et intégration à la plateforme.",
    },
    "services:schedules": {
      purpose: "Lier du travail à une tâche récurrente déclarée dans le manifeste.",
      hostOwns: "Cadence, rattrapage au lancement, prévention des chevauchements et libération.",
    },
    "services:session": {
      purpose: "S’abonner à des faits limités sur la session de lecture actuelle.",
      hostOwns: "Source des événements, limites des charges utiles et cycle de vie de l’abonnement.",
    },
    "services:network": {
      purpose: "Effectuer des requêtes HTTP via le client natif de l’hôte.",
      hostOwns: "Contrôle des permissions, transport et relais des réponses.",
    },
    "services:llm": {
      purpose: "Effectuer des appels ponctuels limités au modèle, textuels ou structurés.",
      hostOwns: "Configuration du fournisseur, identifiants, gestion des schémas et limites.",
    },
    "services:clipboard": {
      purpose: "Écrire du texte dans le presse-papiers système.",
      hostOwns: "Appel de la plateforme et contrôle des permissions.",
    },
    "schemas:views": {
      purpose: "Renvoyer du markdown, des listes, formulaires, détails et arbres de blocs limités.",
      hostOwns: "Composants, sécurité HTML, mise en page, accessibilité et navigation.",
    },
    "schemas:settings": {
      purpose: "Déclarer des champs de paramètres de plugin rendus par l’hôte.",
      hostOwns: "Comportement du formulaire, validation, routage du stockage et gestion des secrets.",
    },
    "schemas:themes": {
      purpose: "Déclarer des tokens de thème sémantiques et des métadonnées de polices intégrées.",
      hostOwns: "Validation de la grammaire, CSS généré, chargement et sélection.",
    },
  },
};

const permissionCopy: PluginPermissionPreviewCopy = {
  inputLabel: "manifest.json",
  inputHint: "Analysé uniquement sur cette page. Rien n’est envoyé.",
  previewLabel: "Aperçu de la révision",
  noAuthority: "Ce manifeste ne demande aucune permission sémantique ni aucun accès aux réglages.",
  invalidJson: "Saisissez un objet JSON valide.",
  issuesTitle: "Notes de révision",
  permissionsTitle: "Autorité utilisateur · permissions sémantiques",
  settingsTitle: "Autorité utilisateur · accès précis aux réglages",
  requirementsTitle: "Compatibilité · pas des permissions",
  declarationsTitle: "Déclarations opérationnelles · pas des permissions",
  none: "Aucune déclaration",
  schemaVersion: "Schéma de données privées",
  schedules: (count) => `${count} ${count === 1 ? "tâche récurrente" : "tâches récurrentes"}`,
  themes: (count) => `${count} ${count === 1 ? "thème" : "thèmes"}`,
  fonts: (count) => `${count} ${count === 1 ? "déclaration de police intégrée" : "déclarations de polices intégrées"}`,
  unknownPermission: (permission) => `Permission inconnue : ${permission}`,
  missingField: (field) => `Champ obligatoire manquant : ${field}`,
  invalidSchemaVersion: "schemaVersion doit être un entier positif.",
  invalidPermissions: "permissions doit être un tableau.",
  invalidSettingsAccess: "settingsAccess doit être un objet.",
  unknownSettingsOperation: (operation) => `Opération de réglage inconnue : ${operation}`,
  invalidSettingsGrant: (operation) => `${operation} doit contenir des chemins exacts ou des groupes section.*.`,
  sectionGrantWarning: (path) => `${path} accorde toute une section de réglages ; préférez les chemins exacts lorsque possible.`,
  permissionDescriptions: {
    "library:read": "Lire les livres, textes sources, métadonnées, sommaires et collections.",
    "library:write": "Modifier la bibliothèque ; l’écriture inclut la lecture.",
    "reading:read": "Lire la session active, la position, la progression et le temps de lecture.",
    "reading:write": "Naviguer et modifier l’état de lecture ; l’écriture inclut la lecture.",
    "annotations:read": "Lire les surlignages et les notes.",
    "annotations:write": "Créer, modifier et supprimer des annotations ; l’écriture inclut la lecture.",
    "conversations:read": "Lire les résumés des conversations de livres et globales.",
    "reader:modes": "Enregistrer un mode de lecture guidé ; actuellement réservé aux plugins intégrés.",
    "agent:tools": "Enregistrer des outils que l’assistant de lecture peut appeler.",
    "agent:context": "Ajouter des blocs de référence non fiables et limités à un tour.",
    "agent:retrieval": "Exposer une source de plugin consultable à l’assistant.",
    "agent:memory": "Proposer des candidats de mémoire durables révisés par l’hôte.",
    "ui:themes": "Fournir des thèmes d’application, des thèmes de lecteur et des polices intégrées.",
    "service:network": "Effectuer des requêtes réseau médiées par l’hôte.",
    "service:llm": "Utiliser le modèle configuré pour des appels ponctuels limités.",
    "service:clipboard": "Écrire du texte dans le presse-papiers système.",
  },
  operationLabels: { discover: "Découvrir", read: "Lire", write: "Écrire" },
  familyLabels: {
    domains: "Domaine",
    contributions: "Contribution",
    services: "Service",
    schemas: "Schéma",
  },
};

const sampleManifest = `{
  "id": "research-notes",
  "name": "Notes de recherche",
  "version": "0.1.0",
  "schemaVersion": 1,
  "requires": {
    "domains": {
      "annotations": "^1.0.0",
      "settings": "^1.0.0"
    },
    "contributions": {
      "commands": "^1.0.0",
      "agentRetrievalProviders": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "network": "^1.0.0"
    },
    "schemas": {
      "settings": "^1.0.0"
    }
  },
  "permissions": [
    "annotations:read",
    "agent:retrieval",
    "service:network"
  ],
  "settingsAccess": {
    "discover": ["appearance.theme"],
    "read": ["appearance.theme"]
  },
  "schedules": [
    {
      "id": "refresh",
      "label": "Actualiser les sources",
      "everyMinutes": 60
    }
  ],
  "main": "main.js"
}`;

function PluginCapabilitiesPage() {
  return (
    <article className="doc-prose">
      <h1>Navigateur des capacités</h1>
      <p className="lead">
        Recherchez dans le catalogue public complet avant de concevoir un plugin. Chaque
        capacité est versionnée indépendamment ; chaque dépendance appartient à la section{" "}
        <code>requires</code> du manifeste.
      </p>

      <PluginCapabilityBrowser copy={capabilityCopy} />

      <h2>Lire le catalogue</h2>
      <ul>
        <li><strong>Autorité</strong> désigne la permission ou l’accès précis aux réglages nécessaire lors de l’appel.</li>
        <li><strong>Aucun</strong> signifie aucune permission d’installation supplémentaire, pas un pouvoir ambiant non documenté.</li>
        <li><strong>L’hôte conserve</strong> marque la limite que le plugin ne peut ni remplacer ni contourner.</li>
        <li>La version affichée à côté de chaque entrée provient directement du catalogue canonique des capacités de l’hôte.</li>
      </ul>
      <p>
        <code>readerModes</code> reste réservé aux plugins intégrés tant que
        son contrat privilégié de lecteur n’est pas stabilisé. Un manifeste ne peut nommer que
        des capacités cataloguées ; l’hôte filtre toujours la vue d’exécution visible
        selon l’acteur, la permission, la version et la phase du cycle de vie.
      </p>

      <h2>Aperçu des permissions</h2>
      <p>
        Collez un manifeste pour séparer l’autorité utilisateur de la compatibilité et des
        déclarations opérationnelles. Cela reflète le sens du consentement d’installation ;
        cela ne remplace pas le validateur du dépôt et ne prouve pas qu’un plugin peut s’activer.
      </p>

      <PluginPermissionPreview copy={permissionCopy} sampleManifest={sampleManifest} />

      <h2>Ce que la boîte d’installation accorde réellement</h2>
      <p>
        Les entrées <code>permissions</code> sémantiques et <code>settingsAccess</code> exactes
        accordent une autorité. La boîte de consentement livrée affiche les deux en
        langage clair. Les exigences de capacités, tâches planifiées, version de schéma,
        thèmes et polices sont utiles pour la révision, mais ne sont pas discrètement
        requalifiées en permissions.
      </p>
      <p>
        Cet aperçu est volontairement local et sans état. La prochaine étape des outils de développement
        est une vue de l’acteur et un inspecteur du cycle de vie dans l’application, fondés sur
        les mêmes catalogues d’exécution, avec les différences de permissions lors des mises à jour
        et les raisons exactes des capacités indisponibles.
      </p>
    </article>
  );
}
