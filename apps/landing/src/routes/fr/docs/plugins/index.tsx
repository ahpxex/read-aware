import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/fr/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "Système d'extensions — Documentation ReadAware" },
      {
        name: "description",
        content:
          "Ce que les extensions ReadAware peuvent faire, comment fonctionne le modèle de confiance, et comment installer des extensions.",
      },
    ],
  }),
  component: PluginsOverviewPage,
});

function PluginsOverviewPage() {
  return (
    <article className="doc-prose">
      <h1>Système d'extensions</h1>
      <p className="lead">
        Les extensions apportent de nouvelles actions, de nouvelles pages, et — surtout — de
        nouveaux outils que l'assistant de lecture peut utiliser. Une extension est un petit
        module JavaScript ; son interface est toujours rendue par le système de design de
        l'application elle-même, donc la fonctionnalité d'une extension ressemble et se
        comporte comme le natif.
      </p>

      <h2>Ce que les extensions peuvent contribuer</h2>
      <ul>
        <li>
          <strong>Actions de sélection</strong> — des entrées dans le menu de sélection de texte
          du lecteur. Envoyez un mot dans Anki, traduisez un paragraphe, enregistrez un extrait
          n'importe où.
        </li>
        <li>
          <strong>Boutons d'en-tête</strong>
          — un bouton icône dans l'en-tête du lecteur ou de la bibliothèque : cliquez pour ouvrir
          un panneau flottant, ou (dans la bibliothèque) une page complète.
        </li>
        <li>
          <strong>Commandes</strong>
          — des entrées dans la palette de commandes. Chaque action d'extension y apparaît
          automatiquement ; les commandes explicites complètent les actions sans bouton.
        </li>
        <li>
          <strong>Outils de l'assistant</strong>
          — des fonctions que l'assistant de lecture peut appeler pendant une conversation.
          C'est le point de montage au plafond le plus élevé : une extension peut permettre à
          l'assistant d'interroger votre collection Anki, votre file RSS, ou n'importe quel
          service que vous utilisez.
        </li>
        <li>
          <strong>Fournisseurs de contenu</strong> — des livres virtuels dont les chapitres sont
          fournis par l'extension à la demande. Un flux RSS peut résider sur votre étagère,
          être lu, annoté et discuté comme n'importe quel livre.
        </li>
        <li>
          <strong>Voix de lecture à haute voix</strong> — connecte des moteurs TTS à la fonction
          de lecture à voix haute de la page de lecture. L'extension synthétise l'audio,
          l'application la lit, et si une seule phrase échoue, elle revient à la voix système.
        </li>
        <li>
          <strong>Paramètres et tâches planifiées</strong> — les paramètres déclaratifs deviennent
          la propre section de l'extension dans Réglages (y compris les clés API, stockées
          chiffrées) ; les tâches périodiques déclarées s'exécutent pendant que l'application
          est ouverte.
        </li>
      </ul>

      <h2>Apparence native, construite</h2>
      <p>
        Les extensions ne rendent jamais leur propre HTML. Elles déclarent des vues avec un petit
        vocabulaire — markdown, listes, formulaires et quelques blocs structurés — et
        l'application les rend avec ses propres composants. Les auteurs d'extensions abandonnent
        le contrôle des pixels en échange de zéro travail de design et d'une application qui
        reste toujours cohérente.
      </p>

      <h2>Modèle de confiance</h2>
      <p>
        Les extensions s'exécutent à l'intérieur de l'application, partageant le même contexte
        JavaScript que l'application — comme Obsidian, et contrairement au sandbox des extensions
        de navigateur. Il y a deux couches de protection pragmatique :
      </p>
      <ul>
        <li>
          <strong>Permissions</strong> — le manifest de l'extension déclare ce qu'elle veut
          utiliser (réseau, lecture des données, IA, presse-papiers…), et l'API expose
          uniquement la partie déclarée. Cela protège contre le dépassement involontaire.
        </li>
        <li>
          <strong>L'installation elle-même est cette décision de confiance.</strong>
          Avant que tout fichier ne soit copié ou exécuté, l'application affiche chaque permission
          demandée par l'extension en langage clair et attend votre consentement. Traitez
          l'installation d'extension comme l'installation d'un logiciel.
        </li>
      </ul>
      <p>
        L'architecture de l'application elle-même limite également la portée : le stockage des
        extensions est isolé par espace de noms dans le répertoire de données de l'application,
        et le shell de bureau n'accorde pas d'accès arbitraire au système de fichiers.
      </p>

      <h2>Installer des extensions</h2>
      <ul>
        <li>
          <strong>Marché d'extensions</strong> — « Réglages → Extensions → Marché d'extensions »
          liste les extensions communautaires du{" "}
          <a
            href={MARKETPLACE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            dépôt d'extensions
          </a>{" "}
          public ; installation en un clic, après avoir montré un résumé des permissions.
        </li>
        <li>
          <strong>Installer depuis un dossier</strong> — « Réglages → Extensions » peut installer
          n'importe quel dossier d'extension local. C'est la boucle de développement : pointez-la
          vers votre répertoire de travail, et réinstallez après chaque modification.
        </li>
      </ul>

      <h2>Le layout est à vous</h2>
      <p>
        Les extensions contribuent des capacités ; où vont les boutons, c'est vous qui décidez.
        « Réglages → Personnaliser » vous permet d'organiser chaque surface (en-tête de la
        bibliothèque, en-tête du lecteur, menu de sélection) : glissez des éléments entre la
        zone affichée et le menu de débordement, réorganisez, ou restaurez les valeurs par défaut.
        Les nouvelles actions d'extension atterrissent discrètement dans le menu de débordement, et
        tout reste accessible depuis la palette de commandes.
      </p>

      <h2 id="read-aloud-tts">Lire à haute voix avec n'importe quelle voix TTS</h2>
      <p>
        L'extension intégrée <strong>TTS Voices</strong> connecte la lecture à haute voix au
        moteur de votre choix — ElevenLabs, Fish Audio, OpenAI, ou n'importe quel point de
        terminaison compatible OpenAI (Kokoro, LocalAI, pont Edge TTS…). Tout se passe dans{" "}
        <strong>Réglages → TTS Voices</strong> : choisissez un fournisseur, ses champs
        apparaissent — la clé API va directement dans le stockage de clés chiffré ; quand le
        fournisseur peut énumérer les voix, le champ de voix devient un menu déroulant (sinon,
        vous pouvez toujours saisir manuellement un nom).
      </p>
      <p>
        Une solution gratuite populaire est d'utiliser les voix neuronales de Microsoft Edge
        via{" "}
        <a
          href="https://github.com/travisvn/openai-edge-tts"
          target="_blank"
          rel="noopener noreferrer"
        >
          openai-edge-tts
        </a>{" "}
        — un petit service local qui parle l'API audio OpenAI :
      </p>
      <ol>
        <li>
          Lancez le service localement — par exemple{" "}
          <code>docker run -d -p 5050:5050 travisvn/openai-edge-tts</code> (pas besoin de clé
          API par défaut).
        </li>
        <li>
          Dans « Réglages → TTS Voices », réglez le fournisseur sur{" "}
          <em>Personnalisé / Local (compatible OpenAI)</em>, et le point de terminaison sur{" "}
          <code>http://127.0.0.1:5050/v1/audio/speech</code>.
        </li>
        <li>
          Choisissez une voix dans la liste — l'application lit le catalogue du serveur, les voix
          Edge complètes (telles que <code>zh-CN-XiaoxiaoNeural</code>,{" "}
          <code>en-US-AriaNeural</code>) apparaissent aux côtés des alias de style OpenAI.
        </li>
      </ol>
      <p>
        Puis ouvrez un livre et commencez à lire : les phrases sont prononcées par votre voix
        choisie, la phrase suivante est pré-chargée pendant la lecture de la phrase actuelle ; si
        une seule synthèse échoue, elle revient à la voix système, sans interrompre la lecture.
      </p>

      <h2>Écrire la vôtre</h2>
      <p>
        Une extension est un dossier contenant un <code>manifest.json</code> et un seul fichier{" "}
        <code>main.js</code>. La <Link to="/fr/docs/plugins/api">référence de l'API</Link>{" "}
        couvre le contrat complet, et{" "}
        <Link to="/fr/docs/plugins/publishing">Publication et distribution</Link> explique comment
        la soumettre au marché d'extensions.
      </p>
    </article>
  );
}
