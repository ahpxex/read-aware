import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/es/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "Referencia API de plugins — Documentación de ReadAware" },
      {
        name: "description",
        content:
          "El contrato de creación de plugins de ReadAware: manifest, ciclo de vida, permisos derivados del dominio, APIs de datos, contribuciones, vistas y eventos.",
      },
    ],
  }),
  component: PluginApiPage,
});

function PluginApiPage() {
  return (
    <article className="doc-prose">
      <h1>Referencia API de plugins</h1>
      <p className="lead">
        Un plugin es una carpeta que contiene un <code>manifest.json</code> y un
        módulo JavaScript. Esta página es el contrato de creación; el mismo contrato
        se envía como un archivo de declaración TypeScript
        (<code>types/plugin-api.d.ts</code>) en el{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          repositorio del Mercado
        </a>
        , por lo que los editores autocompletarán todo lo que sigue.
      </p>

      <h2>Anatomía</h2>
      <pre>
        <code>{`my-plugin/
  manifest.json
  main.js        # un módulo ES autocontenido`}</code>
      </pre>
      <p>
        <code>main.js</code> exporta por defecto un objeto de ciclo de vida. Todo lo que
        un plugin puede alcanzar viene a través del contexto entregado a{" "}
        <code>activate</code>; cada llamada a <code>register*</code> y <code>on</code>{" "}
        devuelve un desechable que la aplicación reclama cuando el plugin se deshabilita
        o desinstala, por lo que <code>deactivate</code> solo necesita liberar los
        recursos externos propios del plugin.
      </p>
      <pre>
        <code>{`export default {
  activate(ctx) {
    // registrar contribuciones vía ctx
  },
  deactivate() {
    // opcional: cerrar sockets, vaciar colas
  },
};`}</code>
      </pre>
      <p>
        Habilitar y deshabilitar surte efecto inmediatamente — sin reiniciar la
        aplicación. Escribe en TypeScript si quieres (recomendado; ver{" "}
        <Link to="/es/docs/plugins/publishing">Publicación</Link>) — lo que la
        aplicación carga es siempre el <code>main.js</code> compilado.
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
              <th>Campo</th>
              <th>Significado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>id</code>
              </td>
              <td>
                Letras minúsculas, dígitos, guiones (máx. 64). Debe igualar el nombre
                de la carpeta; actúa como espacio de nombres para el almacenamiento y
                herramientas del plugin.
              </td>
            </tr>
            <tr>
              <td>
                <code>name</code>, <code>version</code>
              </td>
              <td>Mostrados en Ajustes → Plugins y el Mercado.</td>
            </tr>
            <tr>
              <td>
                <code>minAppVersion</code>
              </td>
              <td>
                Versión mínima de aplicación que el plugin soporta. Este contrato
                requiere <code>0.3.0</code> o más reciente.
              </td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                Lo que usa el plugin (tabla abajo). Se muestra al usuario antes de la
                instalación.
              </td>
            </tr>
            <tr>
              <td>
                <code>main</code>
              </td>
              <td>
                Módulo de entrada relativo a la carpeta; por defecto{" "}
                <code>main.js</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>settings</code>
              </td>
              <td>
                Configuración declarativa opcional (mismas formas de campo que las
                vistas de formulario, más <code>secret</code>). La aplicación las
                renderiza como la propia sección del plugin en Ajustes y persiste los
                valores como un objeto bajo la clave de almacenamiento{" "}
                <code>settings</code> — ver{" "}
                <a href="#storage-and-settings">Almacenamiento y configuración</a>.
              </td>
            </tr>
            <tr>
              <td>
                <code>schedules</code>
              </td>
              <td>
                Tareas recurrentes opcionales, declaradas para que los usuarios las
                vean antes de instalar — ver <a href="#scheduled-work">Trabajo programado</a>.
              </td>
            </tr>
            <tr>
              <td>
                <code>themes</code>, <code>fonts</code>
              </td>
              <td>
                Temas declarativos opcionales y fuentes incluidas (requiere{" "}
                <code>ui:themes</code>) — ver{" "}
                <a href="#themes-and-bundled-fonts">Temas y fuentes incluidas</a>.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>El modelo de dominio</h2>
      <p>
        La superficie de datos se deriva del modelo de dominio de la aplicación en lugar
        de ser escrita junto a él. Cada dominio — <code>shelf</code> (la totalidad de la
        gestión de biblioteca: libros, colecciones, estadísticas de lectura),{" "}
        <code>annotations</code>, <code>conversations</code> — es un espacio de nombres
        en <code>ctx</code> que expone tres cosas:
      </p>
      <ul>
        <li>
          <strong>lecturas</strong> — los modelos de lectura del dominio (lo que las
          propias superficies de la aplicación renderizan);
        </li>
        <li>
          <strong>escrituras</strong> — comandos bajo <code>.write</code> que reflejan
          exactamente los verbos de eventos del dominio y pasan por la propia ruta de
          escritura basada en eventos de la aplicación, estampados{" "}
          <code>plugin:&lt;id&gt;</code> en el registro de eventos para que cada
          escritura de plugin sea atribuible;
        </li>
        <li>
          <strong>suscripciones</strong> — <code>.on(event, handler)</code> sobre los
          eventos del dominio bajo sus nombres canónicos (<code>book.starred</code>,{" "}
          <code>highlight.created</code>, …) — el mismo vocabulario que la aplicación
          registra.
        </li>
      </ul>
      <p>
        Los permisos siguen la misma forma: <code>&lt;domain&gt;:read</code> /{" "}
        <code>&lt;domain&gt;:write</code>, y dentro de un dominio{" "}
        <strong>write implica read</strong>. El estado local del dispositivo
        (preferencias de vista, apariencia del lector, internos de sincronización) y la
        renderización de forma libre están deliberadamente fuera de la superficie de
        plugins — la UI pasa por las vistas declarativas a continuación.
      </p>

      <h2>Permisos</h2>
      <p>
        Los grupos de capacidad en <code>ctx</code> simplemente están ausentes a menos
        que su permiso esté declarado — control a nivel de API contra excesos
        accidentales. El almacenamiento con espacio de nombres, las contribuciones de UI,
        los eventos de sesión y la navegación del lector no son permisos; cada plugin los
        tiene.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Permiso</th>
              <th>Otorga</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>shelf:read</code>
              </td>
              <td>
                <code>ctx.shelf</code> — libros (incl. tabla de contenidos de un libro
                y texto de capítulo), colecciones y membresía, y estadísticas de lectura
                (<code>stats.forBook</code> / <code>stats.list</code> /{" "}
                <code>stats.overview</code> — las estadísticas no tienen cara de
                escritura: sus eventos son hechos registrados de actividad del lector,
                no comandos de usuario).
              </td>
            </tr>
            <tr>
              <td>
                <code>shelf:write</code>
              </td>
              <td>
                <code>ctx.shelf.books.write</code> — importar archivos, editar
                metadatos, marcar con estrella, marcar como terminado, eliminar;
                proveedores de contenido y libros virtuales.{" "}
                <code>ctx.shelf.collections.write</code> — crear, renombrar, eliminar,
                asignar libros.
              </td>
            </tr>
            <tr>
              <td>
                <code>annotations:read</code> / <code>annotations:write</code>
              </td>
              <td>
                <code>ctx.annotations</code> — subrayados, notas y preguntas hechas;
                crear, recolorear, editar y eliminar subrayados y notas (las preguntas
                son escritas por el agente, solo lectura).
              </td>
            </tr>
            <tr>
              <td>
                <code>conversations:read</code>
              </td>
              <td>
                <code>ctx.conversations</code> — hilos de IA por libro e hilos globales
                (solo lectura).
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:themes</code>
              </td>
              <td>
                Los campos declarativos del manifest <code>themes</code> /{" "}
                <code>fonts</code> (abajo) — temas de aplicación y lector con fuentes
                incluidas. La única contribución de UI detrás de un permiso: tiene
                autoridad visual sobre toda la aplicación, por lo que el consentimiento
                de instalación debe mencionarlo.
              </td>
            </tr>
            <tr>
              <td>
                <code>agent:tools</code>
              </td>
              <td>
                <code>ctx.agent.registerTool</code> — herramientas para el asistente de
                lectura.
              </td>
            </tr>
            <tr>
              <td>
                <code>service:network</code>
              </td>
              <td>
                <code>ctx.network.fetch</code> — HTTP saliente a través del cliente
                nativo de la aplicación (sin restricciones CORS).
              </td>
            </tr>
            <tr>
              <td>
                <code>service:llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code> — llamadas únicas al modelo en la cuenta
                configurada del usuario. Sin hilo, sin memoria, sin herramientas;
                soporta salida JSON estructurada vía <code>schema</code> y streaming
                vía <code>onText</code>.
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
        (<code>reader:modes</code> — modos de lectura guiada renderizados por el host —
        está actualmente reservado para los plugins de primera parte incluidos mientras
        ese contrato privilegiado se asienta.)
      </p>

      <h2>Contribuciones</h2>

      <h3>Acciones de selección</h3>
      <p>
        Entradas en los menús de selección y anotación del lector. El manejador recibe
        el texto seleccionado, su rango CFI, el capítulo y el libro. Cuando está
        disponible, <code>context</code> contiene el pasaje circundante. Dentro del
        lector una acción se ejecuta silenciosamente (devuelve un toast) o abre un
        diálogo (devuelve una vista) — esos son los únicos dos resultados. Declara{" "}
        <code>presentation: "dialog"</code> cuando el manejador es async: el host abre
        su shell de carga inmediatamente y llena la misma solicitud cuando{" "}
        <code>run</code> se resuelve. Una acción estilo diccionario puede declarar{" "}
        <code>role: "lookup"</code>; el host entonces enruta su comando de teclado
        Buscar existente a esa acción de plugin en lugar de mantener una segunda ruta
        de búsqueda incorporada.
      </p>
      <pre>
        <code>{`ctx.ui.registerSelectionAction({
  id: "save-quote",
  title: "Save quote",
  icon: "quotes",
  presentation: "dialog",
  run: (input) => {
    // input: { text, context?, cfiRange, chapterHref, book, source }
    return { toast: "Quote saved." };
  },
});`}</code>
      </pre>

      <h3>Acciones de encabezado</h3>
      <p>
        Un botón de icono en una barra superior. En la superficie del lector la vista se
        abre como un popover anclado; en la estantería se abre como un popover o una
        página completa, según <code>presentation</code>. El lector nunca permite
        interrupciones de página completa.
      </p>
      <pre>
        <code>{`ctx.ui.registerHeaderAction({
  id: "reading-report",
  title: "Reading report",
  icon: "chart-line-up",
  surface: "shelf",
  presentation: "page",
  view: async () => ({
    kind: "markdown",
    title: "This week",
    markdown: "You read **4h 12m** across 3 books.",
  }),
});`}</code>
      </pre>

      <h3>Comandos</h3>
      <p>
        Una entrada de paleta de comandos. Todas las acciones de plugins también
        aparecen en la paleta automáticamente; los comandos explícitos son para
        acciones sin botón.
      </p>
      <pre>
        <code>{`ctx.ui.registerCommand({
  id: "sync-now",
  title: "Anki Sync: sync now",
  run: async () => ({ toast: "Synced." }),
});`}</code>
      </pre>

      <h3>Herramientas de agente</h3>
      <p>
        Herramientas que el asistente de lectura puede llamar durante el chat (requiere{" "}
        <code>agent:tools</code>). <code>parameters</code> es un JSON Schema simple para
        el objeto de argumentos; omítelo para una herramienta sin argumentos. Las
        herramientas tienen espacio de nombres{" "}
        <code>plugin_&lt;pluginId&gt;_&lt;name&gt;</code> antes de llegar al modelo, y
        las llamadas son visibles para el usuario como pasos de herramienta en el chat.
      </p>
      <pre>
        <code>{`ctx.agent?.registerTool({
  name: "search_deck",
  label: "Searching your Anki deck",
  description: "Search the user's Anki collection for a term.",
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

      <h3>Proveedores de voz</h3>
      <p>
        <code>ctx.audio.registerVoiceProvider</code> conecta un motor de texto a voz en
        la lectura en voz alta del lector. El plugin solo convierte texto en bytes de
        audio codificado (mp3/wav — cualquier cosa que decodifique el webview); la
        aplicación posee la reproducción, el ritmo de oraciones, la precarga y el
        resaltado de seguimiento. El registro no necesita permiso propio — lo que el
        proveedor necesite para sintetizar (red, claves) ya está controlado por sus
        otros permisos.
      </p>
      <pre>
        <code>{`ctx.audio.registerVoiceProvider({
  id: "voices",
  label: "My TTS",
  listVoices: () => [{ id: "default", label: "My TTS · warm" }],
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
        Una voz registrada se adopta automáticamente — el usuario habilitando tu plugin
        es la adhesión, no hay selector separado del lado del host — y una llamada de
        síntesis fallida vuelve a la voz del sistema para esa oración, por lo que la
        lectura se degrada en lugar de silenciarse. Las voces se relistan cada vez que
        cambia la configuración del plugin.
      </p>

      <h3 id="scheduled-work">Trabajo programado</h3>
      <p>
        El manifest declara tareas recurrentes; <code>activate</code> vincula el
        trabajo. La aplicación ejecuta cada horario AL MENOS cada{" "}
        <code>everyMinutes</code> (piso de 15) mientras está abierta, con una ejecución
        de recuperación poco después del inicio cuando está atrasada — nunca en tiempos
        exactos, y nunca mientras la aplicación está cerrada. Las ejecuciones
        superpuestas de un horario se omiten; una ejecución fallida solo espera la
        siguiente cadencia.
      </p>
      <pre>
        <code>{`// manifest.json
"schedules": [{ "id": "refresh", "label": "Refresh feeds", "everyMinutes": 60 }]

// main.js
ctx.schedule.on("refresh", async () => {
  // obtener, reconciliar, escribir a través de las APIs de dominio
});`}</code>
      </pre>

      <h3 id="themes-and-bundled-fonts">Temas y fuentes incluidas</h3>
      <p>
        Con <code>ui:themes</code>, el manifest puede declarar temas para dos puntos de
        montaje independientes — el chrome de la aplicación y la página del libro — más
        archivos de fuente que se envían dentro de la carpeta del plugin. Esta
        contribución son datos puros: la aplicación valida cada valor y genera todo el
        CSS ella misma, y nada se aplica hasta que el usuario elige el tema en Ajustes →
        Apariencia o el control de color de página del lector. El <code>main.js</code>{" "}
        de un plugin solo de tema es simplemente{" "}
        <code>{"export default { activate() {} }"}</code>.
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
      "name": { "default": "Dusk", "translations": { "zh-Hans": "暮色" } },
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
          <code>polarity</code> — si el tema se lee como claro u oscuro. Maneja{" "}
          <code>color-scheme</code>, los valores predeterminados de polaridad para los
          tokens de aplicación que el tema deja sin configurar, y cómo se resuelve el
          color de página Auto del lector mientras el tema está activo.
        </li>
        <li>
          <code>app</code> — anulaciones en el vocabulario fijo de tokens de la
          aplicación (lienzo, niveles de texto, superficies, rellenos, bordes — ver{" "}
          <code>PluginAppThemeTokens</code> en las declaraciones). Los tokens no
          configurados mantienen los valores propios de la polaridad.
        </li>
        <li>
          <code>reader</code> — la misma paleta de seis colores que usan los colores de
          página integrados (los seis requeridos), más un preset tipográfico opcional
          aplicado una vez cuando el usuario selecciona el tema; el usuario puede
          ajustar todo después.
        </li>
        <li>
          <code>fonts</code> — caras <code>.woff2</code>/<code>.woff</code>/
          <code>.ttf</code>/<code>.otf</code> servidas directamente desde la carpeta del
          plugin; cada una aparece en el selector de fuentes del lector mientras el
          plugin está habilitado. Un tema referencia sus propias fuentes como{" "}
          <code>plugin:&lt;fontId&gt;</code>. Los plugins del Mercado deben listar
          archivos de fuente en el <code>files</code> de la entrada del registro.
        </li>
        <li>
          Los colores se validan contra gramáticas estrictas — hex simple o{" "}
          <code>rgb()</code>/<code>rgba()</code>/<code>hsl()</code>/
          <code>hsla()</code>; las palabras clave, <code>var()</code> y{" "}
          <code>url()</code> se rechazan.
        </li>
      </ul>

      <h2>Vistas</h2>
      <p>
        Los plugins declaran un árbol de componentes del host; la aplicación renderiza
        cada primitiva visual y control. Los plugins nunca proporcionan JSX, HTML, CSS
        o clases.
      </p>
      <ul>
        <li>
          <code>markdown</code> — una cadena markdown, compuesta por la aplicación.
        </li>
        <li>
          <code>list</code> — listas de host con búsqueda con debounce fijo, palabras
          clave, accesorios y estados vacíos. <code>timeline</code> agrega filtros Hoy /
          Esta semana / Este mes / Todo y grupos de fecha local; un elemento puede usar{" "}
          <code>presentation: "dialog"</code> para mostrar su vista devuelta sobre la
          lista en lugar de empujar una página hija. Las <code>actions</code> a nivel de
          lista son botones de icono renderizados por el host; las líneas de tiempo las
          colocan a la derecha de la fila de pestañas.
        </li>
        <li>
          <code>form</code> — controles text, textarea, number, select, choice, checkbox
          y toggle de la biblioteca de componentes de ReadAware, más{" "}
          <code>onSubmit</code>.
        </li>
        <li>
          <code>detail</code> — contenido primario, metadatos y controles y acciones
          renderizados por el host al estilo Raycast. Los controles de selección
          semántica permanecen junto al encabezado de contenido; los diálogos mantienen
          procedencia, fechas y etiquetas en una línea discreta debajo, mientras que las
          acciones se sientan junto al botón Cerrar del host en un pie de página fijo.
        </li>
        <li>
          <code>blocks</code> — tipografía del host, markdown, contenido de diccionario,
          metadatos, citas, acciones, métricas, progreso, etiquetas, alertas, secciones,
          grupos y <code>columns</code> responsivas. Las columnas solo exponen peso
          acotado, espaciado, presets de ancho mínimo y alineación semántica. El CSS
          exacto y el ajuste de línea permanecen dentro del sistema de diseño; las
          declaraciones se validan en tiempo de ejecución y el anidamiento está limitado.
        </li>
      </ul>
      <p>
        Los manejadores (<code>run</code>, <code>onSelect</code>,{" "}
        <code>onSubmit</code>) todos devuelven la misma forma de resultado:
      </p>
      <ul>
        <li>
          nada — la superficie permanece como está;
        </li>
        <li>
          <code>{"{ toast: \"…\" }"}</code> — un aviso transitorio;
        </li>
        <li>
          <code>{"{ view }"}</code> — abrir, o empujar sobre, la superficie;
        </li>
        <li>
          <code>{'{ view, navigation: "replace" | "reset" }'}</code> — reemplazar la
          vista actual, o volver a una nueva vista raíz;
        </li>
        <li>
          <code>{"{ close: true }"}</code> — descartar la superficie (componible con{" "}
          <code>toast</code>);
        </li>
        <li>
          <code>{"{ fieldErrors }"}</code> — desde un envío de formulario: permanecer en
          el formulario y mostrar errores bajo los campos.
        </li>
      </ul>
      <p>
        El trabajo async no es un evento: devuelve una promesa y la aplicación muestra
        el estado de carga. Los iconos se eligen por nombre del conjunto Phosphor
        curado de la aplicación — sin SVG personalizado.
      </p>

      <h2>Datos de dominio</h2>
      <p>
        Cada espacio de nombres de dominio otorgado ofrece lecturas, suscripciones de
        eventos canónicos y (con el permiso de escritura) comandos. En resumen:
      </p>
      <ul>
        <li>
          <code>ctx.shelf.books</code> — <code>list()</code>, <code>get(id)</code>,{" "}
          <code>getToc(id)</code>, <code>getChapterText(id, index)</code>; escritura:{" "}
          <code>import</code>, <code>editMetadata</code>, <code>setStarred</code>,{" "}
          <code>setFinished</code>, <code>remove</code>, más proveedores de contenido
          (abajo).
        </li>
        <li>
          <code>ctx.shelf.collections</code> — <code>list()</code>,{" "}
          <code>booksIn(id)</code>; escritura: <code>create</code>, <code>rename</code>,{" "}
          <code>remove</code>,{" "}
          <code>assignBooks(bookIds, collectionId | null)</code>.
        </li>
        <li>
          <code>ctx.shelf.stats</code> — <code>forBook(bookId)</code>,{" "}
          <code>list()</code>, <code>overview()</code> (posiciones, estados y tiempo de
          lectura activo; solo lectura para cada actor).
        </li>
        <li>
          <code>ctx.annotations</code> —{" "}
          <code>list({"{ bookId?, kind?, query? }"})</code> devuelve una unión
          discriminada de subrayados, notas y preguntas; escritura:{" "}
          <code>createHighlight</code>, <code>recolorHighlight</code>,{" "}
          <code>removeHighlight</code>, <code>createNote</code>,{" "}
          <code>updateNote</code>, <code>removeNote</code>.
        </li>
        <li>
          <code>ctx.conversations</code> — <code>getBookThread(bookId)</code>,{" "}
          <code>listThreads()</code>, <code>getThread(id)</code>; suscribir vía{" "}
          <code>on</code> (<code>aiConversation.started</code>,{" "}
          <code>aiMessage.appended</code>, <code>aiMessage.removed</code>,{" "}
          <code>aiConversation.cleared</code>).
        </li>
      </ul>

      <h2>Eventos</h2>
      <p>
        Dos clases, deliberadamente separadas. <strong>Eventos de dominio</strong> son
        los hechos que la aplicación registra; suscríbete por dominio, bajo nombres
        canónicos, con el permiso de lectura del dominio. Cada entrega es{" "}
        <code>{"{ type, payload, createdAt, origin }"}</code> — origin dice qué actor de
        software produjo el hecho (<code>user</code>, <code>agent</code>,{" "}
        <code>system</code>, o <code>plugin:&lt;id&gt;</code>).
      </p>
      <pre>
        <code>{`ctx.annotations?.on("highlight.created", ({ payload, origin }) => {
  // payload: { highlightId, bookId, text, color?, … }
});
ctx.shelf?.on("book.removed", ({ payload }) => { /* { bookId } */ });
`}</code>
      </pre>
      <p>
        <strong>Hechos de sesión</strong> describen lo que está en pantalla ahora mismo.
        Nunca entran al registro de eventos y no necesitan permiso:{" "}
        <code>ctx.session.on(event, handler)</code>.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Evento de sesión</th>
              <th>Carga útil</th>
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
                <code>{"{ bookId, fraction }"}</code> — se dispara al pasar páginas,
                fracción 0..1
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Proveedores de contenido y libros virtuales</h2>
      <p>
        Con <code>shelf:write</code>, un plugin puede poner libros reales en la
        estantería. <code>import</code> toma los bytes de un archivo. Los proveedores de
        contenido omiten el archivo por completo: registra un proveedor, agrega libros
        virtuales vinculados a él, y sirve secciones HTML cuando se abre el libro. El
        lector pagina, anota y rastrea el progreso en ellos como cualquier libro — un
        feed RSS como libro es exactamente esto.
      </p>
      <pre>
        <code>{`ctx.shelf?.books.write?.registerContentProvider({
  id: "rss",
  async load(key) {
    const feed = await fetchFeed(key); // tu código, vía ctx.network.fetch
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

      <h2 id="storage-and-settings">Almacenamiento y configuración</h2>
      <p>
        <code>ctx.storage</code> es un almacén clave-valor con espacio de nombres
        persistido con los datos locales de la aplicación — <code>get</code>,{" "}
        <code>set</code>, <code>remove</code>. Si el manifest declara campos{" "}
        <code>settings</code>, la aplicación los renderiza como la propia sección del
        plugin en Ajustes y los valores llegan a{" "}
        <code>ctx.storage.get("settings")</code> como un objeto. El asistente de lectura
        también puede ver y cambiar estas configuraciones (los campos marcados{" "}
        <code>agentHidden</code> permanecen fuera de su vista). Tres capacidades de
        campo van más allá de un formulario simple:
      </p>
      <ul>
        <li>
          <code>visibleWhen: {"{ field, equals }"}</code> muestra un campo solo mientras
          otro campo contiene uno de los valores dados. Los campos ocultos mantienen sus
          valores almacenados — un objeto de configuración puede llevar un valor
          configurado por variante (el plugin TTS mantiene una voz por proveedor de esta
          manera).
        </li>
        <li>
          Un <code>select</code> con <code>dynamicOptions: true</code> resuelve sus
          opciones en tiempo de ejecución: vincula la fuente en <code>activate</code>{" "}
          con{" "}
          <code>ctx.settings.provideOptions(fieldId, async (values) =&gt; [...])</code>.
          Cuando la fuente no produce nada (sin credenciales aún, endpoint inaccesible)
          el campo vuelve a entrada de texto libre — listar es una conveniencia, nunca
          una puerta.
        </li>
        <li>
          <code>kind: "secret"</code> declara una credencial: la aplicación renderiza
          una entrada de contraseña escribiendo al almacén secreto cifrado — el id del
          campo ES la clave de <code>ctx.secrets</code> que tu código lee de vuelta —
          nunca a configuración simple, y nunca en el catálogo del asistente. El valor
          almacenado nunca se hace eco; el campo muestra un estado configurado y un
          affordance claro.
        </li>
      </ul>
      <p>
        Para datos estructurados, <code>ctx.storage.collection(name)</code> abre una
        colección de documentos con nombre — <code>put</code> / <code>get</code> /{" "}
        <code>delete</code> / <code>list</code> sobre registros por documento, con
        procedencia <code>bookId</code> / <code>anchor</code> opcional por la que puedes
        filtrar. La procedencia es un índice, no propiedad: los documentos sobreviven la
        eliminación del libro referenciado, y el ciclo de vida de la colección pertenece
        al plugin (desinstalar la limpia). El plugin Dictionary incorporado y su línea
        de tiempo de palabras guardadas están construidos completamente en este nivel.
      </p>

      <h2>Contexto ambiente</h2>
      <p>Siempre disponible, sin permiso necesario:</p>
      <ul>
        <li>
          <code>ctx.manifest</code>, <code>ctx.appVersion</code>,{" "}
          <code>ctx.locale</code> (la locale BCP-47 actual de la UI de la aplicación —
          léela al momento de uso, rastrea la configuración de idioma en vivo);
        </li>
        <li>
          <code>ctx.ui.showToast(message)</code>;
        </li>
        <li>
          <code>ctx.ui.exportFile({"{ filename, content, mimeType? }"})</code> abre el
          flujo de guardado del host para texto generado (CSV, JSON, Markdown) o bytes
          binarios;
        </li>
        <li>
          <code>ctx.secrets</code> — almacenamiento de credenciales cifrado, con espacio
          de nombres por plugin (tokens API y similares); vive fuera de SQLite y copias
          de seguridad y sobrevive la desinstalación;
        </li>
        <li>
          <code>ctx.session.on(…)</code> — los hechos de sesión arriba;
        </li>
        <li>
          <code>ctx.reader.openBook(bookId)</code> y{" "}
          <code>ctx.reader.goTo({"{ bookId?, cfi?, href? }"})</code> — navegar el lector
          (control visible al usuario, sin exposición de datos).
        </li>
      </ul>

      <h2>Estabilidad</h2>
      <p>
        Este es el contrato v2, enviado en la aplicación 0.3.0 — una reconstrucción
        rompedora deliberada que derivó toda la superficie del modelo de dominio (los
        manifests v1 fallan la instalación con un error legible). Desde aquí la API
        crece aditivamente: nuevos dominios, nuevos nombres de eventos, nuevos tipos de
        bloques — los temas declarativos (<code>ui:themes</code>) son la primera de
        esas adiciones. Los cambios rompedores a lo que está documentado aquí se tratan
        como bugs. Declara <code>minAppVersion</code> para cualquier cosa que dependa de
        una adición reciente.
      </p>
    </article>
  );
}
