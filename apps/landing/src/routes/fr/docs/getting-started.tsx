import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/fr/docs/getting-started")({
  head: () => ({
    meta: [
      { title: "Démarrage rapide — Documentation ReadAware" },
      {
        name: "description",
        content:
          "Importer des livres, lire et annoter, connecter un fournisseur IA, et savoir où vivent vos données.",
      },
    ],
  }),
  component: GettingStartedPage,
});

function GettingStartedPage() {
  return (
    <article className="doc-prose">
      <h1>Démarrage rapide</h1>
      <p className="lead">
        ReadAware ouvre directement vos propres fichiers et garde tout ce qu'elle apprend sur
        votre appareil. Cette page vous accompagne pendant la première heure : importer des
        livres, lire et annoter, et — facultativement — connecter l'IA.
      </p>

      <h2>Ajouter des livres</h2>
      <p>
        Importez des fichiers depuis la bibliothèque — ou ignorez complètement les boutons :
        glissez un fichier de livre n'importe où dans la fenêtre pour l'importer ; ou faites de
        ReadAware l'application par défaut pour les formats de livres, et double-cliquez sur un
        fichier dans votre gestionnaire de fichiers : le livre s'ouvrira directement dans le
        lecteur, en l'ajoutant au passage dans votre bibliothèque. ReadAware lit directement{" "}
        <strong>EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML et PDF</strong>
        — aucune conversion, aucun envoi vers le cloud. Le fichier que vous importez est celui
        que vous gardez ; les surlignages, notes et position de lecture restent attachés au
        texte original.
      </p>
      <p>
        Les fichiers protégés par DRM ne peuvent pas être ouverts — les livres achetés sur des
        boutiques chiffrées restent verrouillés. Si le format est pris en charge mais que le
        fichier ne s'ouvre pas, c'est presque toujours pourquoi.
      </p>

      <h2>Lire</h2>
      <p>
        Chaque format s'ouvre dans le même lecteur, avec les mêmes commandes. Les paramètres
        d'apparence du lecteur proposent trois modes de lecture :
      </p>
      <ul>
        <li>
          <strong>Défilement continu</strong> — le mode par défaut ; l'ensemble du livre se
          déroule en une seule colonne fluide.
        </li>
        <li>
          <strong>Page simple</strong> — une page à la fois, tournée comme un livre papier.
        </li>
        <li>
          <strong>Deux pages</strong> — présentation en double page sur les écrans larges.
        </li>
      </ul>
      <p>
        La position de lecture est enregistrée livre par livre ; le sommaire est toujours en
        haut du lecteur, un clic pour l'ouvrir.
      </p>
      <p>
        Ces mêmes paramètres d'apparence régissent également la typographie : police, taille,
        graisse, interligne, espacement des paragraphes, marges et couleur de page. L'alignement
        par défaut est <strong>respecter le livre</strong> — la feuille de style du livre dicte ;
        si vous préférez la cohérence, forcez l'alignement à gauche ou justifié partout.
      </p>
      <p>
        Les livres à mise en page fixe — PDF et bandes dessinées — sont des pages d'images
        pré-rendues, sans typographie modifiable, donc ces paramètres disparaissent. La couleur
        de page fonctionne toujours : la teinte claire teinte le papier lors du rendu, l'encre
        et les photos restent fidèles à l'imprimé ; la teinte sombre redessine toute la page en
        deux tons, gardant le texte lisible. Réglez le <strong>rendu de la page</strong> sur{" "}
        <strong>conserver tel quel</strong> pour qu'un livre garde ses couleurs originales —
        enregistré par livre, pour les albums photo et livres d'art dont la couleur est le contenu.
      </p>

      <h2>Lire à haute voix</h2>
      <p>
        N'importe quel livre peut être lu à voix haute. La lecture s'appuie sur la même navigation
        phrase par phrase / paragraphe par paragraphe que vous utilisez pour lire — lancez la
        navigation, puis appuyez sur lecture dans la barre de navigation, et le livre avancera
        unité par unité, surlignant le texte actuellement lu.
      </p>
      <p>
        Par défaut, elle utilise la voix système de votre appareil, sans clé ni réseau requis.
        Activez une extension vocale — l'extension intégrée <strong>TTS Voices</strong>,
        ou toute autre — cette activation elle-même est le choix « utiliser ce moteur pour la
        lecture » ; la voix spécifique à utiliser se configure dans les paramètres de cette
        extension, avec son fournisseur et son point de terminaison personnalisé. Il n'y a pas
        d'autre sélecteur de voix à synchroniser.
      </p>

      <h2>Annoter</h2>
      <p>Sélectionnez n'importe quel passage de texte et un menu d'actions discret apparaît :</p>
      <ul>
        <li>
          <strong>Surligner</strong> — avec quelques couleurs au choix, ou juste un soulignement.
        </li>
        <li>
          <strong>Note</strong> — attachez vos propres mots à ce passage.
        </li>
        <li>
          <strong>Chercher</strong>
          — le dictionnaire intégré explique un terme dans le contexte de la phrase, pas seulement
          une définition abstraite, et l'enregistre dans votre vocabulaire. (Utilise votre IA
          configurée.)
        </li>
      </ul>
      <p>
        Tout ce que vous marquez est regroupé par livre et intégré à la mémoire de l'application —
        les annotations ne sont pas des archives, mais du matériel que l'assistant lira.
      </p>

      <h2>Connecter l'IA</h2>
      <p>
        Toute l'intelligence de ReadAware fonctionne avec votre propre clé. Sans clé, la lecture,
        l'annotation et la bibliothèque restent pleinement utilisables ; l'assistant, le
        dictionnaire et la mémoire en ont besoin.
      </p>
      <ol>
        <li>Ouvrez « Réglages → IA ».</li>
        <li>
          Choisissez un fournisseur — OpenAI, Anthropic, Google, OpenRouter, DeepSeek, xAI, Groq,
          Mistral, Moonshot, Z.ai, ou connectez n'importe quel point de terminaison compatible
          OpenAI via <strong>Personnalisé</strong>.
        </li>
        <li>Collez votre clé API et sélectionnez un modèle.</li>
      </ol>
      <p>
        ReadAware distingue les modèles <strong>Intelligent</strong> (conversation et synthèse)
        et <strong>Rapide</strong> (dictionnaire, résumés, maintenance de la mémoire) ; chaque
        fournisseur remplit des valeurs par défaut raisonnables. Votre clé est stockée sur votre
        appareil, les requêtes vont directement chez votre fournisseur — aucun serveur ReadAware
        entre les deux.
      </p>

      <h2>Poser des questions</h2>
      <p>
        Chaque livre a une conversation persistante — ouvrez le panneau de discussion en lisant,
        et posez des questions sur ce passage, ce chapitre ou le livre entier. Dans la page{" "}
        <strong>Context</strong>, vous pouvez converser sur toute votre bibliothèque, avec autant
        de fils de discussion que vous le souhaitez.
      </p>
      <p>
        L'assistant travaille à partir de votre lecture : vos surlignages, notes, conversations
        passées, et une mémoire durable qu'il maintient — enregistrant ce que vous avez lu, ce qui
        compte pour vous. Cette mémoire est construite et stockée localement, comme tout le reste.
      </p>

      <h2>Raccourcis</h2>
      <p>
        La palette de commandes (<code>Cmd K</code> sur macOS, <code>Ctrl K</code> ailleurs —
        reconfigurable dans les réglages) accède à toutes les actions : ouvrir des livres, changer
        de vue, exécuter des commandes d'extension.
      </p>

      <h2>Où vivent vos données</h2>
      <p>
        Les livres, annotations, conversations et mémoire sont stockés sur votre appareil. Le
        réseau est utilisé pour les requêtes IA vers votre propre fournisseur — et, si vous
        connectez un compte de synchronisation, via un relais chiffré de bout en bout, pour
        garder votre bibliothèque cohérente entre plusieurs appareils. Avec ou sans
        synchronisation, l'application est entièrement utilisable hors ligne.
      </p>
      <p>
        La synchronisation reste discrète quand elle fonctionne : la progression ne se trouve que
        dans « Réglages → Données et synchronisation », la fenêtre principale ne parle que si
        quelque chose ne va pas — une alerte d'erreur discrète, pouvant être mise en sourdine
        pour un jour.
      </p>
    </article>
  );
}
