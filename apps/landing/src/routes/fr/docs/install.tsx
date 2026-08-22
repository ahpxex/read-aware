import { createFileRoute } from "@tanstack/react-router";
import { useLatestRelease } from "../../../hooks/useLatestRelease";
import { RELEASES_URL } from "../../../lib/releases";

export const Route = createFileRoute("/fr/docs/install")({
  head: () => ({
    meta: [
      { title: "Téléchargement et installation — Documentation ReadAware" },
      {
        name: "description",
        content:
          "Installer ReadAware sur macOS, Windows, Linux, Android ou iOS, et ce qu'il faut savoir pour les builds non signés au premier lancement.",
      },
    ],
  }),
  component: InstallPage,
});

function InstallPage() {
  const release = useLatestRelease();

  return (
    <article className="doc-prose">
      <h1>Téléchargement et installation</h1>
      <p className="lead">
        ReadAware est gratuit. Chaque version publie des paquets pour macOS, Windows,
        Linux et Android{release.tag ? ` ; la version actuelle est ${release.tag}` : ""}. Toutes
        les versions, nouvelles ou anciennes, sont disponibles sur la{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          page releases GitHub
        </a>
        .
      </p>

      <h2>Télécharger</h2>
      <ul>
        {release.downloads.map((download) => {
          if (download.comingSoon) return null;
          const links = [
            ...(download.primary ? [download.primary] : []),
            ...download.extras,
          ];
          return (
            <li key={download.id}>
              <strong>{download.name}</strong>
              {download.id === release.platform ? " (votre plateforme)" : ""} —{" "}
              {links.map((link, index) => (
                <span key={link.url}>
                  {index > 0 ? " · " : ""}
                  <a href={link.url}>{link.label}</a>
                </span>
              ))}
            </li>
          );
        })}
      </ul>

      <h2>macOS</h2>
      <p>
        Téléchargez le <code>.dmg</code> correspondant à votre Mac — Apple Silicon pour les
        puces M, Intel pour les modèles plus anciens — ouvrez-le et glissez ReadAware dans
        Applications.
      </p>
      <p>
        Les builds de bureau ne sont pas encore notarisés par Apple, donc au premier lancement,
        le système vous empêchera d'ouvrir l'application en disant qu'elle ne peut pas être
        vérifiée. Pour continuer :
      </p>
      <ol>
        <li>Essayez d'ouvrir ReadAware une fois, et fermez l'alerte.</li>
        <li>
          Ouvrez « Réglages Système → Confidentialité et sécurité », descendez jusqu'à l'avis
          indiquant que ReadAware a été bloquée, et choisissez <strong>Ouvrir quand même</strong>.
        </li>
      </ol>
      <p>
        Ou, dans le terminal, nettoyez une fois le flag de quarantaine, puis l'application
        s'ouvrira normalement :
      </p>
      <pre>
        <code>xattr -cr /Applications/ReadAware.app</code>
      </pre>

      <h2>Windows</h2>
      <p>
        Téléchargez et lancez le programme d'installation (<code>-setup.exe</code>). Puisque
        le build n'est pas signé, Microsoft Defender SmartScreen risque de bloquer ;
        choisissez <strong>Informations complémentaires</strong>, puis{" "}
        <strong>Exécuter quand même</strong>.
      </p>
      <p>
        Un paquet <code>.msi</code> est disponible pour les installations gérées ; le{" "}
        <code>.zip</code> portable ne nécessite aucune installation — extrayez et lancez{" "}
        <code>ReadAware.exe</code>.
      </p>

      <h2>Linux</h2>
      <p>
        Le fichier <code>.AppImage</code> fonctionne sans installation sur la plupart des
        distributions — rendez-le exécutable et lancez :
      </p>
      <pre>
        <code>{`chmod +x ReadAware-*-linux-x64.AppImage
./ReadAware-*-linux-x64.AppImage`}</code>
      </pre>
      <p>
        AppImage dépend de FUSE ; si votre distribution ne l'inclut pas (certaines distributions
        minimalistes ou très récentes), installez d'abord le paquet <code>libfuse2</code> de votre
        distribution. Des paquets natifs sont également fournis :
      </p>
      <pre>
        <code>{`# Debian / Ubuntu
sudo apt install ./ReadAware-*-linux-x64.deb

# Fedora / RHEL
sudo dnf install ./ReadAware-*-linux-x64.rpm`}</code>
      </pre>

      <h2>Android</h2>
      <p>
        Téléchargez le fichier <code>.apk</code> (arm64) sur votre appareil et ouvrez-le. L'APK
        est signé, mais comme il ne provient pas de l'app store, Android vous demandera au premier
        lancement d'autoriser l'installation depuis le navigateur ou le gestionnaire de fichiers.
      </p>

      <h2>iOS</h2>
      <p>
        ReadAware n'est pas encore sur l'App Store. Cependant, chaque version fournit un fichier{" "}
        <code>.ipa</code> non signé pour le sideloading sur la{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          page releases
        </a>
         : AltStore, SideStore, Sideloadly et autres outils similaires resigneront avec votre
        propre identifiant Apple et l'installeront sur votre appareil. Cette voie est destinée
        aux utilisateurs déjà familiers avec le sideloading ; une version App Store arrivera
        plus tard.
      </p>

      <h2>Rester à jour</h2>
      <p>
        L'application de bureau se met à jour elle-même : elle vérifie les nouvelles versions,
        télécharge les mises à jour en arrière-plan, et les applique au redémarrage. Les paquets
        de mise à jour sont signés cryptographiquement et vérifiés avec une clé intégrée à
        l'application, indépendamment de la signature de code du système d'exploitation. Sur
        Android et iOS, installez manuellement les nouvelles versions depuis la page releases
        pour le moment.
      </p>
      <p>
        Lorsqu'une mise à jour s'applique, une petite bulle vous indique ce qui a changé —
        le changelog dans votre langue, directement dans l'application. Fermez-la et elle
        disparaît pour cette version ; ou désactivez-la complètement dans « Réglages → Général ».
      </p>
    </article>
  );
}
