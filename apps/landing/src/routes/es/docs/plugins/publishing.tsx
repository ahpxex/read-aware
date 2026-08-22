import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/es/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "Publicar un plugin — Documentación de ReadAware" },
      {
        name: "description",
        content:
          "Cómo enviar un plugin al Mercado de ReadAware: estructura del repositorio, validación y expectativas de revisión.",
      },
    ],
  }),
  component: PublishingPage,
});

function PublishingPage() {
  return (
    <article className="doc-prose">
      <h1>Publicar un plugin</h1>
      <p className="lead">
        El Mercado funciona como el repositorio de extensiones de Raycast: tu plugin
        vive en el repositorio público{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins
        </a>{" "}
        y llega vía pull request. Una vez fusionado, aparece en la aplicación bajo
        Ajustes → Plugins → Mercado y se instala con un clic.
      </p>

      <h2>Escribe en TypeScript</h2>
      <p>
        TypeScript es la ruta recomendada. El repositorio incluye una{" "}
        <code>template/</code> con la API tipada (<code>types/plugin-api.d.ts</code>)
        conectada — cópiala, escribe <code>src/main.ts</code>, y compila un módulo
        autocontenido único:
      </p>
      <pre>
        <code>bun build src/main.ts --outfile main.js --format esm</code>
      </pre>
      <p>
        Lo que se envía es siempre el <code>main.js</code> compilado; no dejes de
        hacer commit de <code>src/</code> para que los revisores puedan leer el
        código real. JavaScript simple es igualmente aceptado. Los plugins oficiales en{" "}
        <code>plugins/</code> están escritos de esta manera — úsalos como ejemplos
        vivos.
      </p>

      <h2>Envío</h2>
      <ol>
        <li>Haz fork del repositorio.</li>
        <li>
          Copia <code>template/</code> a{" "}
          <code>plugins/&lt;your-plugin-id&gt;/</code>, conteniendo al menos{" "}
          <code>manifest.json</code> y <code>main.js</code>. El nombre de la carpeta
          debe igualar el <code>id</code> del manifest.
        </li>
        <li>
          Agrega una entrada coincidente a <code>registry.json</code>, manteniendo el
          array ordenado por id.
        </li>
        <li>
          Ejecuta las mismas comprobaciones que ejecutará el CI:
          <pre>
            <code>{`node scripts/validate.mjs
npx tsc --noEmit`}</code>
          </pre>
        </li>
        <li>
          Abre un pull request describiendo qué hace el plugin y por qué necesita cada
          permiso que declara.
        </li>
      </ol>
      <p>
        El CI refuerza la consistencia registro–manifest, la forma del id, la lista
        blanca de permisos y la existencia de archivos, y verifica el tipo de cada
        plugin TypeScript.
      </p>

      <h2>Actualizaciones</h2>
      <p>
        Mismo flujo: incrementa <code>version</code> tanto en{" "}
        <code>manifest.json</code> como en <code>registry.json</code> en un pull
        request. Ten en cuenta que la aplicación lee el registro a través de un CDN, por
        lo que una actualización fusionada puede tardar un poco en aparecer en la
        pestaña del Mercado.
      </p>

      <h2>Expectativas de revisión</h2>
      <ul>
        <li>
          Declara los permisos mínimos. Los pull requests que soliciten más de lo que el
          código usa serán devueltos — ver la{" "}
          <Link to="/es/docs/plugins/api">tabla de permisos</Link>.
        </li>
        <li>
          <code>main.js</code> debe ser legible, o acompañado por la fuente de la que
          fue empaquetado.
        </li>
        <li>
          Sin código ofuscado, sin análisis o rastreo, sin carga remota de código.
        </li>
      </ul>
      <p>
        Los plugins se ejecutan dentro de la aplicación con el mismo acceso que la
        aplicación misma. La instalación es una decisión de confianza que los usuarios
        toman por plugin, y esta revisión es la primera línea de defensa de la comunidad
        — escribe plugins que estarías cómodo instalando de un extraño.
      </p>
    </article>
  );
}
