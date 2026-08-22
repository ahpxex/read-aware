import { Link, createFileRoute } from "@tanstack/react-router";
import { REPO_URL } from "../../../lib/releases";
import { DISCORD_URL } from "../../../lib/site";

export const Route = createFileRoute("/es/docs/")({
  head: () => ({
    meta: [
      { title: "Documentación — ReadAware" },
      {
        name: "description",
        content:
          "Cómo instalar ReadAware, empezar a leer y extender la aplicación con plugins.",
      },
    ],
  }),
  component: DocsOverview,
});

function DocsOverview() {
  return (
    <article className="doc-prose">
      <h1>Documentación</h1>
      <p className="lead">
        ReadAware es una aplicación de lectura nativa de IA: un solo lector para EPUB, MOBI, AZW3,
        FB2, CBZ, CBR, TXT, HTML y PDF que construye memoria a través de tus libros,
        subrayados y conversaciones. Es gratuita, local-first, y funciona con tu propia clave de IA.
      </p>

      <h2>Empieza aquí</h2>
      <ul>
        <li>
          <Link to="/es/docs/install">Descarga e instalación</Link> — instaladores
          para macOS, Windows, Linux y Android, y qué hacer cuando tu sistema operativo
          advierte sobre una aplicación sin firmar.
        </li>
        <li>
          <Link to="/es/docs/getting-started">Primeros pasos</Link> — importa tus
          libros, lee y anota, conecta un proveedor de IA y entiende
          dónde viven tus datos.
        </li>
      </ul>

      <h2>Extiende la aplicación</h2>
      <ul>
        <li>
          <Link to="/es/docs/plugins">Sistema de plugins</Link> — qué pueden hacer
          los plugins y cómo funciona el modelo de confianza.
        </li>
        <li>
          <Link to="/es/docs/plugins/api">Referencia API</Link> — el contrato
          completo de creación: manifest, ciclo de vida, permisos, contribuciones
          y vistas.
        </li>
        <li>
          <Link to="/es/docs/plugins/publishing">Publicación</Link> — cómo llevar
          tu plugin al marketplace integrado en la aplicación.
        </li>
      </ul>

      <h2>Otros recursos</h2>
      <p>
        La aplicación se desarrolla abiertamente en{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . Para preguntas, reportes de bugs o mostrar lo que has construido, únete al{" "}
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Discord
        </a>{" "}
        o abre un issue.
      </p>
    </article>
  );
}
