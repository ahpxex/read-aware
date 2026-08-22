import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/fr/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "Référence de l'API — Documentation ReadAware" },
      {
        name: "description",
        content:
          "Contrat d'écriture d'extensions ReadAware : manifest, cycle de vie, permissions dérivées du domaine, API de données, points de contribution, vues et événements.",
      },
    ],
  }),
  component: PluginApiPage,
});

function PluginApiPage() {
  return (
    <article className="doc-prose">
      <h1>Référence de l'API Extension</h1>
      <p className="lead">
        Une extension est un dossier contenant un <code>manifest.json</code> et un module
        JavaScript. Cette page est le contrat d'écriture ; ce même contrat est publié sous forme
        de fichier de déclarations TypeScript (<code>types/plugin-api.d.ts</code>) avec le{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          dépôt du marché d'extensions
        </a>
        , pour la complétion automatique de l'éditeur sur tout ce qui suit.
      </p>

      <h2>Structure</h2>
      <pre>
        <code>{`my-plugin/
  manifest.json
  main.js        # Un seul module ES autonome`}</code>
      </pre>
      <p>
        <code>main.js</code>{" "}
        exporte par défaut un objet de cycle de vie. Tout ce qu'une extension peut toucher
        provient du contexte passé à <code>activate</code> ; chaque appel{" "}
        <code>register*</code> et <code>on</code> renvoie un objet jetable, que l'application
        nettoie uniformément quand l'extension est désactivée ou désinstallée, donc{" "}
        <code>deactivate</code> ne doit libérer que les ressources externes propres à l'extension.
      </p>
      <pre>
        <code>{`export default {
  activate(ctx) {
    // Enregistrer des points de contribution via ctx
  },
  deactivate() {
    // Optionnel : fermer les sockets, vider les files d'attente
  },
};`}</code>
      </pre>
      <p>
        L'activation et la désactivation prennent effet immédiatement — pas besoin de redémarrer
        l'application. Écrivez en TypeScript si vous le souhaitez (recommandé ; voir{" "}
        <Link to="/fr/docs/plugins/publishing">Publication et distribution</Link>) —
        l'application charge toujours le <code>main.js</code> construit.
      </p>

      <h2>manifest.json</h2>
      <pre>
        <code>{`{
  "id": "anki-sync",
  "name": "Anki Sync",
  "version": "0.1.0",
  "minAppVersion": "0.3.0",
  "description": "Send looked-up words to Anki.",
  "author": "you",
  "permissions": ["service:network", "annotations:read"],
  "main": "main.js"
}`}</code>
      </pre>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Champ</th>
              <th>Signification</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>id</code>
              </td>
              <td>
                Minuscules, chiffres et traits d'union (maximum 64). Doit correspondre au nom du
                dossier ; sert d'espace de noms pour le stockage et les outils de l'extension.
              </td>
            </tr>
            <tr>
              <td>
                <code>name</code>, <code>version</code>
              </td>
              <td>Affiché dans « Réglages → Extensions » et le marché d'extensions.</td>
            </tr>
            <tr>
              <td>
                <code>minAppVersion</code>
              </td>
              <td>
                Version minimale de l'application supportée par l'extension. Ce contrat nécessite{" "}
                <code>0.3.0</code> ou plus récent.
              </td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                Les capacités utilisées par l'extension (voir tableau ci-dessous). Affiché à
                l'utilisateur avant l'installation.
              </td>
            </tr>
            <tr>
              <td>
                <code>main</code>
              </td>
              <td>
                Module d'entrée relatif au dossier de l'extension ; par défaut{" "}
                <code>main.js</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>settings</code>
              </td>
              <td>
                Paramètres déclaratifs optionnels (même forme de champ que les vues de formulaire,
                plus <code>secret</code>). L'application les rend comme section propre à
                l'extension, et persiste toutes les valeurs en tant qu'objet sous la clé de
                stockage <code>settings</code> — voir{" "}
                <a href="#storage-and-settings">Stockage et paramètres</a>.
              </td>
            </tr>
            <tr>
              <td>
                <code>schedules</code>
              </td>
              <td>
                Tâches périodiques optionnelles, déclarées ici pour que les utilisateurs puissent
                les voir avant l'installation — voir{" "}
                <a href="#scheduled-work">Tâches planifiées</a>.
              </td>
            </tr>
            <tr>
              <td>
                <code>themes</code>, <code>fonts</code>
              </td>
              <td>
                Thèmes déclaratifs optionnels et polices groupées (nécessite la permission{" "}
                <code>ui:themes</code>) — voir{" "}
                <a href="#themes-and-bundled-fonts">Thèmes et polices groupées</a>.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Modèle de domaine</h2>
      <p>
        La surface de données est dérivée du modèle de domaine de l'application, pas écrite à
        côté. Chaque domaine — <code>shelf</code> (toute la gestion de la bibliothèque : catalogue
        de livres, regroupements et statistiques de lecture), <code>annotations</code>,{" "}
        <code>conversations</code> — est un espace de noms sur <code>ctx</code>, exposant trois
        choses :
      </p>
      <ul>
        <li>
          <strong>Lectures</strong> — les modèles de lecture de ce domaine (sur lesquels
          l'interface de l'application elle-même se rend) ;
        </li>
        <li>
          <strong>Écritures</strong> — des commandes sous <code>.write</code>, en correspondance
          stricte un-à-un avec les verbes d'événement de ce domaine, et passant par le propre
          chemin d'écriture event-sourced de l'application, marqué dans le journal d'événements
          comme <code>plugin:&lt;id&gt;</code>, donc chaque écriture d'extension est traçable ;
        </li>
        <li>
          <strong>Abonnements</strong> — <code>.on(event, handler)</code>, abonnez-vous aux
          événements de ce domaine par des noms canoniques (<code>book.starred</code>,{" "}
          <code>highlight.created</code>…) — le même vocabulaire avec lequel l'application
          elle-même enregistre les faits.
        </li>
      </ul>
      <p>
        Les permissions suivent la même forme : <code>&lt;domain&gt;:read</code> /{" "}
        <code>&lt;domain&gt;:write</code>, et dans un domaine,{" "}
        <strong>l'écriture implique la lecture</strong>. L'état local de l'appareil (préférences
        de vue, apparence du lecteur, données internes de synchronisation) et le rendu libre sont
        délibérément hors de la surface d'extension — toute l'UI passe par les vues déclaratives
        ci-dessous.
      </p>

      <h2>Permissions</h2>
      <p>
        Sans la permission correspondante déclarée, le groupe de capacités sur <code>ctx</code>{" "}
        n'existe tout simplement pas — protection au niveau de l'API contre le dépassement
        involontaire. Le stockage par espace de noms, les points de contribution d'interface, les
        événements de session et la navigation du lecteur ne sont pas des permissions ; chaque
        extension les possède.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Permission</th>
              <th>Accorde</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>shelf:read</code>
              </td>
              <td>
                <code>ctx.shelf</code>
                — catalogue de livres (y compris le sommaire d'un livre et le texte des
                chapitres), regroupements et affectations, et statistiques de lecture (
                <code>stats.forBook</code> / <code>stats.list</code> /{" "}
                <code>stats.overview</code>
                — les statistiques n'ont pas de face d'écriture : leurs événements sont les faits
                de l'activité du lecteur enregistrée, pas de commandes utilisateur).
              </td>
            </tr>
            <tr>
              <td>
                <code>shelf:write</code>
              </td>
              <td>
                <code>ctx.shelf.books.write</code>
                — importer des fichiers, modifier les métadonnées, marquer en vedette, marquer
                comme terminé, supprimer ; et les fournisseurs de contenu et livres virtuels.
                <code>ctx.shelf.collections.write</code>
                — créer, renommer, supprimer, attribuer des livres aux collections.
              </td>
            </tr>
            <tr>
              <td>
                <code>annotations:read</code> / <code>annotations:write</code>
              </td>
              <td>
                <code>ctx.annotations</code>
                — surlignages, notes et questions ; créer, recolorer, modifier, supprimer les
                surlignages et notes (les questions sont écrites par l'assistant, lecture seule).
              </td>
            </tr>
            <tr>
              <td>
                <code>conversations:read</code>
              </td>
              <td>
                <code>ctx.conversations</code>
                — les fils IA par livre et les fils globaux (lecture seule).
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:themes</code>
              </td>
              <td>
                Champs déclaratifs <code>themes</code> / <code>fonts</code> dans le manifest (voir
                ci-dessous) — thèmes d'application et de lecture, avec des polices facultatives.
                C'est le seul point de contribution d'UI nécessitant une permission : il a un
                impact visuel sur toute l'application, la confirmation d'installation doit le
                mettre en lumière.
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:appearance</code>
              </td>
              <td>
                <code>ctx.appearance</code> — lister tous les thèmes proposés
                par les deux surfaces, lire l’apparence actuelle et changer le
                thème de l’application ou la couleur de page. Volontairement
                distinct de <code>ui:themes</code> : proposer un thème est
                passif, en changer ne l’est pas.
              </td>
            </tr>
            <tr>
              <td>
                <code>agent:tools</code>
              </td>
              <td>
                <code>ctx.agent.registerTool</code> — enregistrer des outils pour l'assistant de
                lecture.
              </td>
            </tr>
            <tr>
              <td>
                <code>service:network</code>
              </td>
              <td>
                <code>ctx.network.fetch</code> — requêtes HTTP sortantes, via le client natif de
                l'application (pas de contrainte CORS).
              </td>
            </tr>
            <tr>
              <td>
                <code>service:llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code>
                — faire un appel de modèle unique en utilisant le compte configuré de
                l'utilisateur. Pas de fil, pas de mémoire, pas d'outils ; prend en charge la
                sortie JSON structuré via <code>schema</code>, ou la réception de texte en flux
                via <code>onText</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>service:clipboard</code>
              </td>
              <td>
                <code>ctx.clipboard.writeText</code>.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        (<code>reader:modes</code>
        — modes de lecture guidés rendus par l'hôte — temporairement limité aux extensions de
        première partie livrées avec l'application jusqu'à ce que ce contrat privilégié se
        stabilise.)
      </p>

      <h2>Points de contribution</h2>

      <h3>Actions de sélection</h3>
      <p>
        Entrées dans le menu de sélection du lecteur et le menu d'annotation. Le gestionnaire
        reçoit le texte sélectionné, sa plage CFI, le chapitre et le livre ; quand le lecteur
        peut le récupérer, <code>context</code> porte également les paragraphes de contexte
        autour de la sélection. À l'intérieur du lecteur, une action soit s'exécute silencieusement
        (retourne un toast), soit ouvre un dialogue (retourne une vue) — seulement ces deux
        résultats. Les actions asynchrones déclarant <code>presentation: "dialog"</code> font
        que l'hôte ouvre immédiatement un dialogue en état de chargement, et remplit le résultat
        dans la même requête quand <code>run</code> se termine. Les actions de type dictionnaire
        peuvent déclarer <code>role: "lookup"</code> : l'hôte routera la commande clavier
        « Chercher » existante vers cette action d'extension, au lieu de maintenir un second
        chemin de recherche intégré.
      </p>
      <pre>
        <code>{`ctx.ui.registerSelectionAction({
  id: "save-quote",
  title: "Enregistrer la citation",
  icon: "quotes",
  presentation: "dialog",
  run: (input) => {
    // input: { text, context?, cfiRange, chapterHref, book, source }
    return { toast: "Citation enregistrée." };
  },
});`}</code>
      </pre>

      <h3>Actions d'en-tête</h3>
      <p>
        Un bouton icône dans l'en-tête. Sur la surface du lecteur, la vue s'ouvre en panneau
        ancré ; sur la bibliothèque, elle s'ouvre selon <code>presentation</code> en panneau ou
        en page complète. Le lecteur ne permet jamais d'interruption en pleine page.
      </p>
      <pre>
        <code>{`ctx.ui.registerHeaderAction({
  id: "reading-report",
  title: "Bilan de lecture",
  icon: "chart-line-up",
  surface: "shelf",
  presentation: "page",
  view: async () => ({
    kind: "markdown",
    title: "Cette semaine",
    markdown: "Vous avez lu **4h 12m** sur 3 livres.",
  }),
});`}</code>
      </pre>

      <h3>Commandes</h3>
      <p>
        Une entrée dans la palette de commandes. Toutes les actions d'extension apparaissent
        automatiquement dans la palette ; les commandes explicites servent pour les actions sans
        bouton.
      </p>
      <pre>
        <code>{`ctx.ui.registerCommand({
  id: "sync-now",
  title: "Anki Sync: synchroniser maintenant",
  run: async () => ({ toast: "Synchronisé." }),
});`}</code>
      </pre>

      <h3>Outils de l'assistant</h3>
      <p>
        Outils que l'assistant de lecture peut appeler pendant une conversation (nécessite la
        permission <code>agent:tools</code>). <code>parameters</code> est un schéma JSON ordinaire
        décrivant l'objet de paramètres ; les outils sans paramètres peuvent l'omettre. Les
        outils sont préfixés par espace de noms en{" "}
        <code>plugin_&lt;pluginId&gt;_&lt;name&gt;</code> avant d'être envoyés au modèle, et les
        invocations apparaissent dans la conversation en tant qu'étapes d'outil pour
        l'utilisateur.
      </p>
      <pre>
        <code>{`ctx.agent?.registerTool({
  name: "search_deck",
  label: "Recherche de votre paquet Anki",
  description: "Rechercher un terme dans la collection Anki de l'utilisateur.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async ({ query }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8765", {
      method: "POST",
      body: JSON.stringify({ action: "findNotes", query }),
    });
    return res.json();
  },
});`}</code>
      </pre>

      <h3>Fournisseurs de voix de lecture à haute voix</h3>
      <p>
        <code>ctx.audio.registerVoiceProvider</code>{" "}
        connecte un moteur de synthèse vocale à la fonction de lecture à haute voix de la page de
        lecture. L'extension synthétise uniquement le texte en octets audio encodés (mp3/wav —
        tout ce que la webview peut décoder) ; la lecture, la progression phrase par phrase, la
        pré-récupération et le surlignage de suivi sont tous gérés par l'application.
        L'enregistrement lui-même ne nécessite pas de permission — les capacités requises pour
        la synthèse (réseau, clés) sont déjà protégées par les propres autres permissions de
        l'extension.
      </p>
      <pre>
        <code>{`ctx.audio.registerVoiceProvider({
  id: "voices",
  label: "Mon TTS",
  listVoices: () => [{ id: "default", label: "Mon TTS · chaleureux" }],
  synthesize: async ({ text, voiceId }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8880/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: text, response_format: "mp3" }),
    });
    return res.arrayBuffer();
  },
});`}</code>
      </pre>
      <p>
        Les voix enregistrées sont automatiquement adoptées — activer votre extension est le
        choix, l'hôte ne maintient pas de sélecteur distinct ; si une seule synthèse échoue, elle
        revient à la voix système, la lecture se dégrade seulement, sans interruption. Les
        changements de paramètres d'extension déclenchent une réénumération des voix.
      </p>

      <h3 id="scheduled-work">Tâches planifiées</h3>
      <p>
        Le manifest déclare les tâches périodiques, <code>activate</code> lie le travail réel.
        L'application exécute au moins toutes les <code>everyMinutes</code> minutes (minimum 15)
        pendant qu'elle est ouverte, et rattrape une exécution manquée au démarrage —
        jamais de promesse de moment précis, et aucune exécution si l'application est fermée. Les
        exécutions simultanées de la même tâche sont ignorées ; un échec attend simplement la
        période suivante.
      </p>
      <pre>
        <code>{`// manifest.json
"schedules": [{ "id": "refresh", "label": "Actualiser les flux", "everyMinutes": 60 }]

// main.js
ctx.schedule.on("refresh", async () => {
  // récupérer, comparer, réécrire via les APIs de domaine
});`}</code>
      </pre>

      <h3 id="themes-and-bundled-fonts">Thèmes et polices groupées</h3>
      <p>
        Avec <code>ui:themes</code> déclaré, le manifest peut déclarer des thèmes pour deux points
        de montage indépendants — l'interface de l'application et les pages de livres — et grouper
        des fichiers de polices distribués avec le dossier de l'extension. Ces contributions sont
        purement des données : l'application valide chaque valeur et génère tout le CSS
        elle-même, et rien ne prend effet avant que l'utilisateur ne sélectionne le thème dans
        « Réglages → Apparence » ou le sélecteur de couleur de page du lecteur. Les extensions
        purement thème ont juste besoin de{" "}
        <code>{"export default { activate() {} }"}</code> dans <code>main.js</code>.
      </p>
      <pre>
        <code>{`{
  "permissions": ["ui:themes"],
  "fonts": [
    {
      "id": "my-serif",
      "family": "My Serif",
      "kind": "serif",
      "files": [{ "path": "assets/my-serif-400.woff2", "weight": 400 }]
    }
  ],
  "themes": [
    {
      "id": "dusk",
      "name": { "default": "Crépuscule", "translations": { "zh-Hans": "暮色" } },
      "polarity": "dark",
      "app": { "paper": "#14171e", "fg": "#e3e6ec" },
      "reader": {
        "palette": {
          "bg": "#161a22", "text": "#ccd2dd",
          "selection": "rgba(154, 162, 177, 0.28)",
          "rule": "rgba(204, 210, 221, 0.18)",
          "faint": "rgba(204, 210, 221, 0.07)",
          "muted": "rgba(204, 210, 221, 0.55)"
        },
        "typography": { "fontFamily": "plugin:my-serif", "fontSize": "large" }
      }
    }
  ]
}`}</code>
      </pre>
      <ul>
        <li>
          <code>polarity</code> — si le thème lit clair ou sombre. Pilote{" "}
          <code>color-scheme</code>, les valeurs par défaut de polarité claires/sombres dont les
          tokens d'application non remplacés héritent, et la résolution de la couleur de page
          « Auto » du lecteur pendant que le thème est actif.
        </li>
        <li>
          <code>app</code> — remplace le vocabulaire de tokens fixes de l'application (toile,
          hiérarchie de texte, surfaces, remplissage, bordures — voir{" "}
          <code>PluginAppThemeTokens</code> dans la déclaration de type). Les tokens non remplacés
          gardent les propres valeurs de polarité correspondantes.
        </li>
        <li>
          <code>reader</code> — une palette à six couleurs (les six obligatoires) identique aux
          couleurs de page intégrées, plus un préréglage de typographie optionnel : appliqué une
          fois au moment où l'utilisateur sélectionne le thème, puis l'utilisateur peut ajuster
          librement.
        </li>
        <li>
          <code>fonts</code> — <code>.woff2</code>/<code>.woff</code>/<code>.ttf</code>/
          <code>.otf</code> servis directement depuis le dossier de l'extension ; chaque police
          apparaît dans le sélecteur de polices du lecteur pendant que l'extension est activée. Les
          thèmes référencent leurs propres polices avec <code>plugin:&lt;fontId&gt;</code>. Les
          extensions soumises au marché doivent lister les fichiers de police dans le champ{" "}
          <code>files</code> de l'entrée de registre.
        </li>
        <li>
          Les valeurs de couleur sont validées par syntaxe stricte — hex pur ou{" "}
          <code>rgb()</code>/<code>rgba()</code>/<code>hsl()</code>/<code>hsla()</code> ; les
          mots-clés, <code>var()</code> et <code>url()</code> sont rejetés.
        </li>
      </ul>

      <h2>Vues</h2>
      <p>
        Les extensions déclarent des arbres de composants hôtes, l'application rend toutes les
        primitives visuelles et contrôles ; les extensions ne peuvent pas fournir de JSX, HTML, CSS
        ou className.
      </p>
      <ul>
        <li>
          <code>markdown</code> — une chaîne markdown, rendue par l'application.
        </li>
        <li>
          <code>list</code> — l'hôte fournit la recherche avec debounce fixe, keywords,
          accessories et état vide ; <code>timeline</code> fournit un filtre aujourd'hui / cette
          semaine / ce mois / tout et un regroupement de dates locales, les éléments peuvent
          utiliser <code>presentation: "dialog"</code> pour ouvrir une vue de retour au-dessus de
          la liste, au lieu de descendre dans une sous-page.
        </li>
        <li>
          <code>form</code> — text, textarea, number, time, select, choice, checkbox, toggle utilisant
          la bibliothèque de composants ReadAware, plus <code>onSubmit</code> ; ce dernier reçoit
          les valeurs du formulaire, peut retourner une vue de résultat ou des erreurs de champ.
        </li>
        <li>
          <code>detail</code> — contenu principal, métadonnées et actions de style Raycast ;
          l'hôte rend les actions comme boutons icônes à droite du titre du contenu, et affiche
          discrètement les métadonnées source, date et tags au bas du contenu.
        </li>
        <li>
          <code>blocks</code>
          — typography hôte, markdown, dictionnaire, métadonnées, citation, actions, métrique,
          progression, tags, avertissement, section, group et <code>columns</code> responsive. Les
          colonnes exposent uniquement le weight relatif, les niveaux d'espacement, les niveaux de
          largeur minimale et l'alignement sémantique, le CSS réel et le wrapping restent au
          système de design ; toutes les déclarations sont validées au runtime et la profondeur
          d'imbrication est limitée.
        </li>
      </ul>
      <p>
        Les gestionnaires (<code>run</code>, <code>onSelect</code>, <code>onSubmit</code>)
        retournent tous la même forme de résultat :
      </p>
      <ul>
        <li>
          Ne retourner rien — l'UI reste comme elle est ;
        </li>
        <li>
          <code>{"{ toast: \"…\" }"}</code> — un message bref ;
        </li>
        <li>
          <code>{"{ view }"}</code> — ouvrir une UI, ou pousser une nouvelle couche de vue par-dessus ;
        </li>
        <li>
          <code>{'{ view, navigation: "replace" | "reset" }'}</code>
          — remplacer la vue actuelle, ou revenir à un nouvel arbre racine ;
        </li>
        <li>
          <code>{"{ close: true }"}</code> — fermer l'UI (combinable avec <code>toast</code>) ;
        </li>
        <li>
          <code>{"{ fieldErrors }"}</code>
          — depuis la soumission de formulaire : rester dans le formulaire et afficher les erreurs
          sous les champs.
        </li>
      </ul>
      <p>
        Le travail asynchrone n'est pas remarquable : retournez une promesse, l'application
        affiche un état de chargement. Les icônes sont choisies par nom dans la collection Phosphor
        sélectionnée par l'application — pas de SVG personnalisé pris en charge.
      </p>

      <h2>Données de domaine</h2>
      <p>
        Chaque espace de noms de domaine accordé fournit des lectures, des abonnements aux
        événements canoniques, et (avec permission d'écriture) des commandes. Vue d'ensemble :
      </p>
      <ul>
        <li>
          <code>ctx.shelf.books</code> — <code>list()</code>, <code>get(id)</code>,{" "}
          <code>getToc(id)</code>, <code>getChapterText(id, index)</code>
          ; écritures : <code>import</code>, <code>editMetadata</code>, <code>setStarred</code>,{" "}
          <code>setFinished</code>, <code>remove</code>, plus les fournisseurs de contenu (voir
          ci-dessous).
        </li>
        <li>
          <code>ctx.shelf.collections</code> — <code>list()</code>, <code>booksIn(id)</code>
          ; écritures : <code>create</code>, <code>rename</code>, <code>remove</code>,{" "}
          <code>assignBooks(bookIds, collectionId | null)</code>.
        </li>
        <li>
          <code>ctx.shelf.stats</code> — <code>forBook(bookId)</code>, <code>list()</code>,{" "}
          <code>overview()</code>
          (position de lecture, état de lecture et durée de lecture réelle ; lecture seule pour
          tout acteur).
        </li>
        <li>
          <code>ctx.annotations</code> —{" "}
          <code>list({"{ bookId?, kind?, query? }"})</code> retourne une union discriminée de
          surlignages, notes et questions ; écritures : <code>createHighlight</code>,{" "}
          <code>recolorHighlight</code>, <code>removeHighlight</code>, <code>createNote</code>,{" "}
          <code>updateNote</code>, <code>removeNote</code>.
        </li>
        <li>
          <code>ctx.conversations</code> — <code>getBookThread(bookId)</code>,{" "}
          <code>listThreads()</code>, <code>getThread(id)</code> ; abonnez-vous via{" "}
          <code>on</code> (<code>aiConversation.started</code>,{" "}
          <code>aiMessage.appended</code>, <code>aiMessage.removed</code>,{" "}
          <code>aiConversation.cleared</code>).
        </li>
      </ul>

      <h2>Événements</h2>
      <p>
        Deux types d'événements, délibérément séparés. <strong>Les événements de domaine</strong>{" "}
        sont les faits enregistrés par l'application ; abonnez-vous par domaine, utilisez des noms
        canoniques, nécessite la permission de lecture de ce domaine. Chaque livraison est de la
        forme <code>{"{ type, payload, createdAt, origin }"}</code> — origin montre quel acteur
        logiciel a produit ce fait (<code>user</code>, <code>agent</code>, <code>system</code>, ou{" "}
        <code>plugin:&lt;id&gt;</code>).
      </p>
      <pre>
        <code>{`ctx.annotations?.on("highlight.created", ({ payload, origin }) => {
  // payload: { highlightId, bookId, text, color?, … }
});
ctx.shelf?.on("book.removed", ({ payload }) => { /* { bookId } */ });`}</code>
      </pre>
      <p>
        <strong>Les faits de session</strong> décrivent ce qui se passe à l'écran en ce moment.
        Ils n'entrent jamais dans le journal d'événements, et ne nécessitent aucune permission :{" "}
        <code>ctx.session.on(event, handler)</code>.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Événement de session</th>
              <th>Charge utile</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>book-opened</code>
              </td>
              <td>
                <code>{"{ book: { id, title, author? } }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>book-closed</code>
              </td>
              <td>
                <code>{"{ bookId }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>chapter-changed</code>
              </td>
              <td>
                <code>{"{ bookId, chapterHref }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>reading-progress</code>
              </td>
              <td>
                <code>{"{ bookId, fraction }"}</code> — déclenché lors du tournage de page,
                fraction dans 0..1
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Fournisseurs de contenu et livres virtuels</h2>
      <p>
        Avec <code>shelf:write</code> déclaré, les extensions peuvent placer de vrais livres sur
        la bibliothèque. <code>import</code> accepte des octets de fichier. Les fournisseurs de
        contenu contournent complètement les fichiers : enregistrez un fournisseur, ajoutez des
        livres virtuels liés à celui-ci, et fournissez des chapitres HTML à la demande lorsque le
        livre est ouvert. Le lecteur les pagine, annote, enregistre la progression comme tout
        livre — « lire un flux RSS comme un livre » est exactement ainsi implémenté.
      </p>
      <pre>
        <code>{`ctx.shelf?.books.write?.registerContentProvider({
  id: "rss",
  async load(key) {
    const feed = await fetchFeed(key); // votre code, via ctx.network.fetch
    return {
      title: feed.title,
      sections: feed.items.map((item) => ({
        title: item.title,
        html: item.contentHtml,
      })),
    };
  },
});

await ctx.shelf?.books.write?.addVirtualBook({
  providerId: "rss",
  key: "https://example.com/feed.xml",
  title: "Example Weekly",
});`}</code>
      </pre>

      <h2 id="storage-and-settings">Stockage et paramètres</h2>
      <p>
        <code>ctx.storage</code>{" "}
        est un stockage clé-valeur par espace de noms persisté avec les données locales de
        l'application — <code>get</code>, <code>set</code>, <code>remove</code>. Si le manifest
        déclare un champ <code>settings</code>, l'application les rend comme la propre section
        de paramètres de l'extension, toutes les valeurs apparaissent comme un objet dans{" "}
        <code>ctx.storage.get("settings")</code>. L'assistant de lecture peut également
        voir et modifier ces paramètres (les champs marqués <code>agentHidden</code> lui sont
        invisibles). Trois capacités de champ vont au-delà du formulaire ordinaire :
      </p>
      <ul>
        <li>
          <code>visibleWhen: {"{ field, equals }"}</code> affiche un champ seulement lorsqu'un
          autre champ prend une valeur donnée. La valeur existante du champ masqué est conservée —
          un objet de paramètres unique peut stocker un ensemble de valeurs pour chaque variante
          (l'extension TTS stocke ainsi une voix pour chaque fournisseur).
        </li>
        <li>
          <code>select</code> avec <code>dynamicOptions: true</code> résout les options au moment
          de l'exécution : liez une source dans <code>activate</code> avec{" "}
          <code>ctx.settings.provideOptions(fieldId, async (values) =&gt; [...])</code>. Quand la
          source ne peut pas fournir d'options (pas encore de clé configurée, point de terminaison
          inaccessible), le champ revient à la saisie de texte libre — la liste est une commodité,
          jamais une barrière.
        </li>
        <li>
          <code>kind: "secret"</code> déclare un champ d'identifiants : l'application rend une
          entrée de mot de passe et écrit directement dans le stockage de secrets chiffré — l'id
          du champ est la clé que vous lisez avec <code>ctx.secrets</code> dans votre code — ne va
          jamais dans les paramètres en texte clair, ne va jamais dans le catalogue de l'assistant.
          La valeur existante n'est jamais ré-affichée ; le champ se présente comme état
          « configuré » avec une entrée de nettoyage.
        </li>
      </ul>
      <p>
        Pour les données structurées, <code>ctx.storage.collection(name)</code> ouvre une
        collection de documents nommée — <code>put</code> / <code>get</code> / <code>delete</code>{" "}
        / <code>list</code> les documents individuels, les documents peuvent facultativement
        porter des informations de provenance <code>bookId</code> / <code>anchor</code> et peuvent
        être filtrés par celles-ci. La provenance est un index, pas une propriété : les documents
        survivent à la suppression du livre référencé ; et le cycle de vie de la collection
        appartient à l'extension (désinstaller efface).
        L'extension vocabulaire intégrée est entièrement construite sur cette couche.
      </p>

      <h2>Contexte résident</h2>
      <p>Toujours disponible, aucune permission nécessaire :</p>
      <ul>
        <li>
          <code>ctx.manifest</code>, <code>ctx.appVersion</code>, <code>ctx.locale</code> (balise
          de langue BCP-47 actuelle de l'interface de l'application — lire au moment de
          l'utilisation, elle change avec le réglage de langue en temps réel) ;
        </li>
        <li>
          <code>ctx.ui.showToast(message)</code> ;
        </li>
        <li>
          <code>ctx.ui.exportFile({"{ filename, content, mimeType? }"})</code>
          — ouvre le flux de sauvegarde de l'hôte, exporte du texte généré (CSV, JSON, Markdown)
          ou des octets binaires ;
        </li>
        <li>
          <code>ctx.secrets</code> — stockage d'identifiants chiffrés isolé par espace de noms de
          l'extension (jetons API, etc.) ; stocké en dehors de SQLite et des sauvegardes, survit à
          la désinstallation ;
        </li>
        <li>
          <code>ctx.session.on(…)</code> — les faits de session ci-dessus ;
        </li>
        <li>
          <code>ctx.reader.openBook(bookId)</code> et{" "}
          <code>ctx.reader.goTo({"{ bookId?, cfi?, href? }"})</code>
          — navigation dans le lecteur (contrôle visible de l'utilisateur, n'expose pas de
          données).
        </li>
      </ul>

      <h2>Stabilité</h2>
      <p>
        Ceci est le contrat v2, livré avec l'application 0.3.0 — une refonte disruptive
        intentionnelle qui dérive toute la surface d'extension du modèle de domaine (les manifests
        v1 échoueront à l'installation avec des messages d'erreur lisibles). À partir de maintenant,
        l'API ne fait que grandir additivement : nouveaux domaines, nouveaux noms d'événements,
        nouveaux types de blocs — les thèmes déclaratifs (<code>ui:themes</code>) en sont le
        premier ajout. Les modifications disruptives du contenu déjà documenté sur cette page
        seront traitées comme des bugs. Toute extension dépendant d'une capacité plus récente
        ajoutée devrait déclarer <code>minAppVersion</code>.
      </p>
    </article>
  );
}
