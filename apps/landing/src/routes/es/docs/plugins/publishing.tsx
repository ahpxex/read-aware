import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/es/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "Publicar un plugin — Documentación de ReadAware" },
      {
        name: "description",
        content:
          "Preparar, validar, revisar y enviar un plugin de ReadAware al repositorio público del marketplace.",
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
        Los paquetes del marketplace viven en el{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          repositorio readaware-plugins
        </a>{" "}
        público y pasan por revisión. El catálogo actual es oficial; este proceso también es el contrato para aceptar envíos externos.
      </p>

      <h2>Preparar un paquete revisable</h2>
      <p>
        Se recomienda TypeScript. Mantén <code>src/</code> junto al <code>main.js</code>
        autónomo para que los revisores comparen el código fuente y el artefacto. Incluye todos los recursos de ejecución. No cargues código remoto, ocultes comportamiento en blobs generados ni dependas de archivos externos al paquete.
      </p>
      <pre><code>{`plugins/my-plugin/
  manifest.json
  main.js
  package.json
  tsconfig.json
  src/main.ts
  assets/…`}</code></pre>

      <h2>Ejecutar las comprobaciones del repositorio</h2>
      <pre><code>{`bun run build
bun run typecheck
bun test
bun run validate`}</code></pre>
      <p>
        La validación comprueba la coherencia entre registro y manifest, IDs, versiones, requisitos de capacidades, permisos, archivos declarados y estructura del paquete. Son comprobaciones necesarias, no suficientes: prueba la carpeta compilada en ReadAware Desktop antes de enviarla.
      </p>

      <h2>Enviar</h2>
      <ol>
        <li>Haz fork del repositorio público.</li>
        <li>Copia la plantilla en <code>plugins/&lt;plugin-id&gt;/</code> y mantén el nombre de carpeta igual al ID del manifest.</li>
        <li>Añade el paquete y todos los recursos de ejecución necesarios.</li>
        <li>Añade la entrada correspondiente, ordenada por ID, a <code>registry.json</code>.</li>
        <li>Ejecuta las cuatro comprobaciones raíz y prueba la instalación local desde la carpeta compilada.</li>
        <li>Abre un pull request que describa el comportamiento, los datos privados, los servicios externos y el motivo de cada permiso y autorización de Ajustes.</li>
      </ol>

      <h2>Lista de revisión</h2>
      <ul>
        <li>La función usa las capacidades existentes más específicas de Dominio, Contribución y Servicio.</li>
        <li><code>requires</code> nombra cada contrato utilizado con un rango semver justificable.</li>
        <li>Los permisos y <code>settingsAccess</code> coinciden con las llamadas reales y no contienen autoridad especulativa.</li>
        <li><code>activate()</code> registra comportamiento, pero no ejecuta efectos secundarios empresariales o externos.</li>
        <li>Los datos privados del plugin tienen un esquema estable y cada transición de versión cuenta con una migración probada.</li>
        <li>Los endpoints de red, el uso de LLM, las credenciales, las tareas programadas y la retención de datos se explican claramente.</li>
        <li>Las vistas del host funcionan con navegación por teclado, textos largos, datos vacíos y temas claros y oscuros.</li>
        <li>El código fuente es legible, la salida generada reproducible y no hay analítica, seguimiento, ofuscación ni carga de código remoto.</li>
      </ul>
      <p>
        La <Link to="/es/docs/plugins/capabilities">vista previa de permisos</Link> es una comprobación previa útil. La validación del repositorio y la revisión humana siguen siendo las comprobaciones autoritativas.
      </p>

      <h2>Actualizaciones y migración de datos</h2>
      <p>
        Incrementa la versión del paquete tanto en <code>manifest.json</code>
        como en <code>registry.json</code>. Incrementa <code>schemaVersion</code>
        solo cuando cambie la forma del KV privado o de los documentos, y
        distribuye el <code>migrate()</code> correspondiente en el mismo candidato.
      </p>
      <p>
        Prueba la actualización y una degradación deliberada con datos realistas.
        ReadAware prepara y comprueba la salud del candidato, toma instantáneas
        de los archivos y datos del plugin, pausa el runtime antiguo para la
        migración y solo promociona después de tener éxito. Una actualización
        fallida debe dejar utilizables el paquete y los datos anteriores.
      </p>

      <h2>Cambios de permisos</h2>
      <p>
        Trata la nueva autoridad como un cambio de producto, no como simple
        mantenimiento del manifest. Explica por qué el conjunto de permisos
        anterior es insuficiente, a qué datos del usuario u operación externa se
        obtiene acceso y qué ocurre cuando el usuario rechaza. Elimina los
        permisos que el código ya no utilice.
      </p>

      <h2>Confianza de distribución actual</h2>
      <p>
        El aislamiento del Worker y la aplicación de capacidades reducen los
        excesos, pero instalar sigue siendo una decisión de confianza. Antes de
        abrir un marketplace amplio a terceros, ReadAware aún necesita identidad
        del editor, empaquetado determinista, firma y verificación de integridad,
        procedencia de la revisión, revocación, revisión de diferencias de
        permisos y un canal de respuesta de seguridad.
      </p>
      <p>
        Hasta que se incorporen esos controles, una entrada fusionada en el
        repositorio es evidencia de revisión, no una garantía matemática de que
        el código hostil arbitrario sea seguro.
      </p>

      <h2>Antes de abrir el pull request</h2>
      <p>
        Vuelve a leer <Link to="/es/docs/plugins/develop">Crear un plugin</Link>,
        compara el manifest final en las{" "}
        <Link to="/es/docs/plugins/capabilities">herramientas de capacidades</Link>
        y confirma que el paquete sigue el{" "}
        <Link to="/es/docs/plugins/api">contrato de la API</Link> actual, en lugar
        de un ejemplo antiguo de <code>shelf</code> o <code>appearance</code>.
      </p>
    </article>
  );
}
