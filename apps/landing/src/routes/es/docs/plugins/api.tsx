import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/es/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "Referencia de la API de plugins — Documentación de ReadAware" },
      {
        name: "description",
        content:
          "El contrato actual de plugins de ReadAware: manifest, capacidades, dominios, contribuciones, servicios, UI declarativa, ciclo de vida y migraciones.",
      },
    ],
  }),
  component: PluginApiPage,
});

function PluginApiPage() {
  return (
    <article className="doc-prose">
      <h1>Referencia de la API de plugins</h1>
      <p className="lead">
        Un plugin es una carpeta con <code>manifest.json</code> y un módulo ES
        compilado. El contrato público exacto de TypeScript se distribuye como{" "}
        <code>types/plugin-api.d.ts</code> en el{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          repositorio readaware-plugins
        </a>. Esta página explica cómo encajan sus piezas.
      </p>

      <h2>Estructura del paquete</h2>
      <pre><code>{`my-plugin/
  manifest.json
  main.js
  src/main.ts       # recomendado y confirmado para revisión
  assets/           # opcional, listado explícitamente para instalaciones desde el marketplace`}</code></pre>
      <p>
        <code>main.js</code> exporta por defecto un objeto de ciclo de vida.
        ReadAware lo ejecuta en un Worker de módulos dedicado y entrega a
        <code>activate</code> un contexto delimitado por actor.
      </p>
      <pre><code>{`export default {
  activate(ctx) {
    // Inspeccionar y registrar. Los efectos secundarios están bloqueados en esta fase.
  },
  migrate(storageCtx, change) {
    // Opcional: transformar el KV privado y los documentos del plugin.
  },
  deactivate() {
    // Opcional: liberar los recursos externos propios del plugin.
  },
};`}</code></pre>

      <h2>Manifiesto</h2>
      <pre><code>{`{
  "id": "theme-schedule",
  "name": "Programación de temas",
  "version": "0.1.0",
  "schemaVersion": 1,
  "minAppVersion": "0.3.0",
  "requires": {
    "domains": { "settings": "^1.0.0" },
    "contributions": {
      "commands": "^1.0.0",
      "settingsOptions": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "ui": "^1.0.0"
    },
    "schemas": { "settings": "^1.0.0" }
  },
  "settingsAccess": {
    "discover": ["appearance.theme", "reading.theme"],
    "write": ["appearance.theme", "reading.theme"]
  },
  "main": "main.js"
}`}</code></pre>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Campo</th><th>Contrato</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>Letras minúsculas, dígitos y guiones; máximo de 64 caracteres. Es el espacio de nombres permanente y debe coincidir con el nombre de la carpeta.</td></tr>
            <tr><td><code>name</code>, <code>version</code></td><td>Nombre visible para el usuario y versión del paquete.</td></tr>
            <tr><td><code>schemaVersion</code></td><td>Entero positivo obligatorio para el KV privado del plugin y los datos de documentos. Es independiente de la versión del paquete.</td></tr>
            <tr><td><code>requires</code></td><td>Mapa obligatorio de IDs de capacidades a rangos semver, agrupados por dominios, contribuciones, servicios y esquemas.</td></tr>
            <tr><td><code>permissions</code></td><td>Autoridad semántica opcional solicitada al usuario. Los valores desconocidos hacen fallar la validación.</td></tr>
            <tr><td><code>settingsAccess</code></td><td>Concesiones opcionales de discover/read/write para rutas exactas de ajustes o grupos explícitos <code>section.*</code>.</td></tr>
            <tr><td><code>minAppVersion</code></td><td>Límite inferior opcional de versión de la aplicación. Úsalo cuando el paquete dependa de una capacidad incorporada recientemente.</td></tr>
            <tr><td><code>settings</code></td><td>Campos opcionales de ajustes del plugin renderizados por el host.</td></tr>
            <tr><td><code>schedules</code></td><td>Tareas recurrentes opcionales, declaradas antes de vincular sus manejadores.</td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>Contribuciones declarativas opcionales de temas y fuentes; requieren <code>ui:themes</code>.</td></tr>
            <tr><td><code>main</code></td><td>Módulo de entrada relativo a la carpeta; por defecto es <code>main.js</code>.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Usa el <Link to="/es/docs/plugins/capabilities">navegador de capacidades</Link>{" "}
        para consultar el catálogo completo y el vocabulario de permisos. Un
        requisito siempre es una afirmación de compatibilidad; nunca concede autoridad.
      </p>

      <h2>Contexto de ejecución</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Espacio de nombres</th><th>Contiene</th></tr></thead>
          <tbody>
            <tr><td><code>ctx.manifest</code></td><td>El manifest validado, de solo lectura.</td></tr>
            <tr><td><code>ctx.appVersion</code>, <code>ctx.locale</code></td><td>Versión del host y locale actual de la UI.</td></tr>
            <tr><td><code>ctx.lifecycle.phase</code></td><td><code>activating</code>, <code>migrating</code> o <code>active</code>.</td></tr>
            <tr><td><code>ctx.capabilities</code></td><td>Solo las versiones de capacidades visibles para este actor del plugin.</td></tr>
            <tr><td><code>ctx.domains</code></td><td>Estado y comportamiento de ReadAware concedidos al plugin.</td></tr>
            <tr><td><code>ctx.contributions</code></td><td>Registros en los que el plugin puede proporcionar implementaciones.</td></tr>
            <tr><td><code>ctx.services</code></td><td>Operaciones acotadas del host e infraestructura privada del plugin.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Los espacios de nombres protegidos por permisos están ausentes cuando no
        se conceden. Cada llamada del Worker también se autoriza en el host;
        ocultar un método no es la única comprobación. Los registros devuelven
        un recurso desechable y se recuperan en orden inverso cuando falla la
        activación o se desactiva el plugin.
      </p>

      <h2>Dominios</h2>
      <p>
        Un Dominio expone <code>queries</code>, <code>commands</code> opcionales y
        <code>events.subscribe</code> para eventos confirmados. Los comandos
        usan la misma ruta de escritura basada en eventos que ReadAware y se
        atribuyen a <code>plugin:&lt;id&gt;</code>. El permiso de escritura implica
        el de lectura.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Dominio</th><th>Consultas y comandos</th><th>Autoridad</th></tr></thead>
          <tbody>
            <tr>
              <td><code>library</code></td>
              <td>Libros, metadatos, texto fuente de capítulos, TOC y colecciones; comandos para importar, editar, marcar, eliminar, gestionar libros virtuales y colecciones.</td>
              <td><code>library:read</code> / <code>library:write</code></td>
            </tr>
            <tr>
              <td><code>reading</code></td>
              <td>Estadísticas de lectura por libro y agregadas; marcar como terminado, abrir un libro y navegar a un CFI o href.</td>
              <td><code>reading:read</code> / <code>reading:write</code></td>
            </tr>
            <tr>
              <td><code>annotations</code></td>
              <td>Filtrar resaltados, notas y registros de consultas pasivas; crear, editar, recolorear y eliminar resaltados o notas.</td>
              <td><code>annotations:read</code> / <code>annotations:write</code></td>
            </tr>
            <tr>
              <td><code>conversations</code></td>
              <td>Leer hilos de libros, listar hilos globales y leer un hilo. Las escrituras permanecen en el runtime del chat.</td>
              <td><code>conversations:read</code></td>
            </tr>
            <tr>
              <td><code>settings</code></td>
              <td>Descubrir entradas permitidas del catálogo, leer valores resueltos, actualizar objetivos compatibles y suscribirse a cambios confirmados.</td>
              <td>Concesiones exactas de <code>settingsAccess</code></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        No existe ningún dominio <code>shelf</code> ni <code>appearance</code>.
        Los datos de la biblioteca y el comportamiento de lectura activa están
        separados. Apariencia es una sección dentro de Ajustes.
      </p>

      <h3>Acceso a Ajustes</h3>
      <p>
        <code>discover</code>, <code>read</code> y <code>write</code> son
        independientes. Concede rutas exactas siempre que sea posible; usa un
        grupo de sección como <code>appearance.*</code> solo cuando la función
        necesite realmente toda la sección. Las actualizaciones pasan por la
        validación del catálogo, la política de objetivos, la persistencia y los
        efectos posteriores a la confirmación.
      </p>
      <pre><code>{`const entries = await ctx.domains.settings.queries.discover({
  section: "appearance",
});

await ctx.domains.settings.commands.update([
  {
    path: "appearance.theme",
    value: "dark",
    target: { kind: "global" },
  },
]);`}</code></pre>

      <h2>Contribuciones</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Registro</th><th>El plugin proporciona</th><th>Permiso</th></tr></thead>
          <tbody>
            <tr><td><code>selectionActions</code></td><td>Acción de selección y manejador que devuelve un aviso o una vista renderizada por el host.</td><td>Ninguno</td></tr>
            <tr><td><code>headerActions</code></td><td>Acción del lector o la biblioteca, metadatos de posición y callback de vista.</td><td>Ninguno</td></tr>
            <tr><td><code>commands</code></td><td>Metadatos del comando y manejador.</td><td>Ninguno</td></tr>
            <tr><td><code>settingsOptions</code></td><td>Opciones dinámicas para un campo de plugin declarado.</td><td>Ninguno</td></tr>
            <tr><td><code>voiceProviders</code></td><td>Lista de voces y síntesis de audio codificado.</td><td>Ninguno</td></tr>
            <tr><td><code>contentProviders</code></td><td>Secciones para una clave de libro virtual.</td><td>Ninguno</td></tr>
            <tr><td><code>readerModes</code></td><td>Modo acotado de segmentación del lector; actualmente solo para plugins incluidos.</td><td><code>reader:modes</code></td></tr>
            <tr><td><code>agentTools</code></td><td>Esquema de herramienta, etiqueta visible, descripción y ejecutor.</td><td><code>agent:tools</code></td></tr>
            <tr><td><code>agentContextProviders</code></td><td>Bloques de referencia acotados para el turno actual.</td><td><code>agent:context</code></td></tr>
            <tr><td><code>agentRetrievalProviders</code></td><td>Resultados de búsqueda de datos propios del plugin.</td><td><code>agent:retrieval</code></td></tr>
            <tr><td><code>memoryCandidateProviders</code></td><td>Posibles hechos, preferencias, ideas o resúmenes persistentes.</td><td><code>agent:memory</code></td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>Datos semánticos de temas y fuentes declarados en el manifest.</td><td><code>ui:themes</code></td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Cada ID de contribución tiene un espacio de nombres por plugin, cada
        registro tiene propietario y se puede inspeccionar, y los recursos
        desechables obsoletos no pueden eliminar un reemplazo más reciente. Un
        nuevo tipo de contribución aún necesita un consumidor deliberado del
        host; después, cualquier plugin compatible puede registrarse sin que la
        aplicación tenga que nombrarlo.
      </p>

      <h3>Límites de extensión del agente</h3>
      <ul>
        <li><strong>Los proveedores de contexto</strong> se ejecutan durante un turno. El host añade procedencia, limita el tamaño y serializa la salida como datos de referencia no confiables.</li>
        <li><strong>Los proveedores de recuperación</strong> se convierten en herramientas con espacio de nombres, un esquema <code>query</code>/<code>limit</code> propiedad del host y resultados recortados.</li>
        <li><strong>Los proveedores de candidatos de memoria</strong> proponen candidatos acotados después de un turno; el host valida el ámbito, elimina duplicados y realiza cualquier escritura persistente.</li>
      </ul>
      <p>
        Los plugins nunca reciben el puerto de Memoria, no pueden inyectar reglas
        del sistema ni escribir directamente en la memoria a largo plazo.
      </p>

      <h2>Servicios del host</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Servicio</th><th>Contrato</th><th>Permiso</th></tr></thead>
          <tbody>
            <tr><td><code>storage</code></td><td>KV con espacio de nombres, colecciones de documentos y notificaciones de cambios externos.</td><td>Ninguno</td></tr>
            <tr><td><code>secrets</code></td><td>Ranuras de credenciales cifradas con espacio de nombres.</td><td>Ninguno</td></tr>
            <tr><td><code>ui</code></td><td>Aviso del host y flujo de guardado/exportación.</td><td>Ninguno</td></tr>
            <tr><td><code>schedules</code></td><td>Vincular un manejador a una cadencia declarada en el manifest.</td><td>Ninguno</td></tr>
            <tr><td><code>session</code></td><td>Suscribirse a hechos acotados de la sesión de lectura.</td><td>Ninguno</td></tr>
            <tr><td><code>network</code></td><td>HTTP mediado por el host.</td><td><code>service:network</code></td></tr>
            <tr><td><code>llm</code></td><td>Llamadas de una sola vez al modelo, de texto o limitadas por un esquema JSON, usando la configuración del usuario.</td><td><code>service:llm</code></td></tr>
            <tr><td><code>clipboard</code></td><td>Escribir texto en el portapapeles del sistema.</td><td><code>service:clipboard</code></td></tr>
          </tbody>
        </table>
      </div>

      <h3>Almacenamiento</h3>
      <p>
        Usa KV para ajustes pequeños y puntos de control. Usa una colección de
        documentos con nombre para registros propios del plugin, con IDs estables
        y procedencia opcional <code>bookId</code>/<code>anchor</code>. La
        procedencia es un índice, no propiedad; un documento puede sobrevivir a
        la eliminación del libro referenciado. La desinstalación vacía las
        colecciones de documentos, pero conserva el KV, las ranuras de secretos y
        los metadatos de esquema confirmados para reinstalar y migrar.
      </p>

      <h3>Programaciones</h3>
      <p>
        El manifest declara <code>{`{ id, label, everyMinutes }`}</code> y la
        activación vincula el manejador mediante
        <code>ctx.services.schedules.bind</code>. La cadencia mínima es de 15
        minutos. Las ejecuciones ocurren al menos con esa cadencia mientras la
        aplicación está abierta, se ponen al día al iniciar cuando están
        atrasadas y no se solapan. No es un trabajo de fondo duradero ni una
        garantía de hora exacta.
      </p>

      <h2>UI declarativa y ajustes</h2>
      <p>
        Los plugins devuelven datos de vista versionados, no UI ejecutable. La
        gramática de vistas incluye markdown, listas consultables, formularios,
        diseños de detalle, resultados de diccionario y árboles de bloques
        acotados. Los manejadores pueden conservar la superficie, mostrar un
        aviso, abrir o reemplazar una vista, restablecer la navegación, cerrar la
        superficie o devolver errores de campos. El host se encarga de los
        estados de carga y error de las promesas.
      </p>
      <p>
        Los ajustes del manifest usan controles del host para campos de texto,
        textarea, número, hora, selección, opciones, casilla, interruptor y
        secretos. Los campos condicionales usan <code>visibleWhen</code>; las
        selecciones dinámicas usan un proveedor <code>settingsOptions</code>
        registrado. Los campos secretos escriben directamente en ranuras de
        secretos cifradas y nunca entran en el objeto de ajustes ordinario ni en
        el catálogo visible para el agente.
      </p>

      <h2>Temas y fuentes</h2>
      <p>
        Los plugins de temas declaran datos semánticos en el manifest. Un tema de
        la aplicación sobrescribe un vocabulario fijo de tokens del host; un tema
        del lector proporciona la paleta de página obligatoria de seis colores y
        valores tipográficos predeterminados opcionales. El host valida los
        valores, genera CSS, carga archivos de fuentes locales aprobados y no
        aplica nada hasta que el usuario lo selecciona.
      </p>
      <p>
        Proporcionar opciones requiere <code>ui:themes</code>. Seleccionar una
        requiere una concesión exacta de escritura en Ajustes, como
        <code>appearance.theme</code> o <code>reading.theme</code>. Una no implica
        la otra.
      </p>

      <h2>Fases del ciclo de vida</h2>
      <ol>
        <li><strong>Activación:</strong> las consultas y lecturas privadas del plugin están disponibles; los registros se preparan y los efectos secundarios están bloqueados.</li>
        <li><strong>Migración:</strong> solo están disponibles el KV del plugin y las colecciones de documentos.</li>
        <li><strong>Activo:</strong> los manejadores promocionados pueden usar sus dominios, contribuciones y servicios concedidos.</li>
      </ol>
      <p>
        El host procesa las RPC de activación, comprueba la salud del Worker,
        ejecuta cualquier migración de datos y después promociona todo el
        conjunto preparado en un único punto explícito. Una activación fallida
        elimina el trabajo preparado sin reemplazar el runtime actual.
      </p>

      <h2>Entorno del Worker</h2>
      <p>
        No hay acceso a React, Jotai, DOM, WebView, Tauri, SQLite, sistema de
        archivos ni procesos. Las API ambientales <code>fetch</code>, WebSocket,
        EventSource, XMLHttpRequest, BroadcastChannel, IndexedDB y Cache Storage
        están desactivadas. Usa el contexto tipado para la red, la persistencia y
        toda interacción con el host.
      </p>

      <h2>Compatibilidad y estabilidad</h2>
      <p>
        Los dominios, las contribuciones, los servicios y los esquemas
        declarativos tienen cada uno una versión semántica independiente. Los
        IDs desconocidos, los rangos semver inválidos, las capacidades requeridas
        inaccesibles y las versiones incompatibles del host impiden la activación.
        Las adiciones compatibles incrementan la capacidad propietaria, no un
        único número global de API del plugin.
      </p>
      <p>
        El ecosistema actual es propio, por lo que el contrato vigente respaldado
        por el registro es la base. No dependas de las formas anteriores
        <code>shelf</code>, <code>appearance</code> ni de las anteriores al registro.
      </p>
    </article>
  );
}
