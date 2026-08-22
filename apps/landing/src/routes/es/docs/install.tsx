import { createFileRoute } from "@tanstack/react-router";
import { useLatestRelease } from "../../../hooks/useLatestRelease";
import { RELEASES_URL } from "../../../lib/releases";

export const Route = createFileRoute("/es/docs/install")({
  head: () => ({
    meta: [
      { title: "Descarga e instalación — Documentación de ReadAware" },
      {
        name: "description",
        content:
          "Instala ReadAware en macOS, Windows, Linux, Android o iOS, incluyendo notas sobre el primer inicio en versiones sin firmar.",
      },
    ],
  }),
  component: InstallPage,
});

function InstallPage() {
  const release = useLatestRelease();

  return (
    <article className="doc-prose">
      <h1>Descarga e instalación</h1>
      <p className="lead">
        ReadAware es gratuita. Cada versión incluye instaladores para macOS, Windows,
        Linux y Android{release.tag ? `; la versión actual es ${release.tag}` : ""}.
        Todas las versiones, pasadas y presentes, se encuentran en la{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          página de releases de GitHub
        </a>
        .
      </p>

      <h2>Descargas</h2>
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
              {download.id === release.platform ? " (tu plataforma)" : ""} —{" "}
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
        Descarga el <code>.dmg</code> para tu Mac — Apple Silicon para máquinas con chip M,
        Intel para las más antiguas — ábrelo y arrastra ReadAware a Aplicaciones.
      </p>
      <p>
        Las versiones de escritorio aún no están notarizadas por Apple, por lo que el primer
        inicio se bloquea con una advertencia de que no se pudo verificar la aplicación. Para
        abrirla de todas formas:
      </p>
      <ol>
        <li>Intenta abrir ReadAware una vez y cierra la advertencia.</li>
        <li>
          Abre Ajustes del Sistema → Privacidad y Seguridad, desplázate hasta el aviso
          de que ReadAware fue bloqueada y selecciona <strong>Abrir de todas formas</strong>.
        </li>
      </ol>
      <p>
        Alternativamente, limpia la marca de cuarentena una vez desde Terminal y abre
        normalmente:
      </p>
      <pre>
        <code>xattr -cr /Applications/ReadAware.app</code>
      </pre>

      <h2>Windows</h2>
      <p>
        Descarga y ejecuta el instalador (<code>-setup.exe</code>). Como la versión aún
        no está firmada con código, Microsoft Defender SmartScreen puede interponerse;
        elige <strong>Más información</strong> y luego{" "}
        <strong>Ejecutar de todas formas</strong>.
      </p>
      <p>
        Hay un paquete <code>.msi</code> disponible para instalaciones administradas, y
        un <code>.zip</code> portable que se ejecuta sin instalar nada — desempaquétalo
        e inicia <code>ReadAware.exe</code>.
      </p>

      <h2>Linux</h2>
      <p>
        El <code>.AppImage</code> se ejecuta en la mayoría de las distribuciones sin
        instalación — hazlo ejecutable e inícialo:
      </p>
      <pre>
        <code>{`chmod +x ReadAware-*-linux-x64.AppImage
./ReadAware-*-linux-x64.AppImage`}</code>
      </pre>
      <p>
        Las AppImages requieren FUSE; en distribuciones que no lo tienen (algunas
        mínimas o muy recientes), instala primero el paquete <code>libfuse2</code> de
        tu distribución. También hay paquetes nativos disponibles:
      </p>
      <pre>
        <code>{`# Debian / Ubuntu
sudo apt install ./ReadAware-*-linux-x64.deb

# Fedora / RHEL
sudo dnf install ./ReadAware-*-linux-x64.rpm`}</code>
      </pre>

      <h2>Android</h2>
      <p>
        Descarga el <code>.apk</code> (arm64) en tu dispositivo y ábrelo. El APK está
        firmado; Android aún te pedirá que permitas instalaciones desde tu navegador o
        administrador de archivos la primera vez, ya que no proviene de una tienda.
      </p>

      <h2>iOS</h2>
      <p>
        ReadAware aún no está en la App Store. Cada versión incluye un <code>.ipa</code>{" "}
        sin firmar en la{" "}
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          página de releases
        </a>{" "}
        para sideloading: herramientas como AltStore, SideStore o Sideloadly lo firman
        con tu propio Apple ID y lo instalan en tu dispositivo. Este método es para
        personas ya familiarizadas con el sideloading; una versión de tienda llegará
        más adelante.
      </p>

      <h2>Mantenerse actualizado</h2>
      <p>
        La aplicación de escritorio se actualiza sola: busca nuevas versiones, descarga
        la actualización en segundo plano y la aplica al reiniciar. Los paquetes de
        actualización están firmados criptográficamente y verificados contra una clave
        integrada en la aplicación, independiente de la firma de código del sistema operativo.
        En Android e iOS, instala las nuevas versiones manualmente desde la página de
        releases por ahora.
      </p>
      <p>
        Cuando llega una actualización, un pequeño diálogo presenta lo que cambió — las
        notas de la versión, en tu idioma, mostradas directamente en la aplicación.
        Cerrarlo es permanente para esa versión, y el diálogo se puede desactivar
        completamente en Ajustes → General.
      </p>
    </article>
  );
}
