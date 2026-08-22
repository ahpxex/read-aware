import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/es/docs/getting-started")({
  head: () => ({
    meta: [
      { title: "Primeros pasos — Documentación de ReadAware" },
      {
        name: "description",
        content:
          "Importa tus libros, lee y anota, conecta un proveedor de IA y aprende dónde viven tus datos.",
      },
    ],
  }),
  component: GettingStartedPage,
});

function GettingStartedPage() {
  return (
    <article className="doc-prose">
      <h1>Primeros pasos</h1>
      <p className="lead">
        ReadAware abre tus propios archivos y mantiene todo lo que aprende en tu
        dispositivo. Esta página te guía por la primera hora: importar libros, leer y
        anotar, y — opcionalmente — conectar una IA.
      </p>

      <h2>Agrega tus libros</h2>
      <p>
        Importa archivos desde la estantería — o sáltate el botón por completo: arrastra
        archivos de libros a cualquier parte de la ventana, o haz de ReadAware la
        aplicación predeterminada para tus formatos de libros y haz doble clic en ellos
        en tu administrador de archivos, lo que abre el libro directamente en el lector
        y lo agrega a la estantería en el proceso. ReadAware lee{" "}
        <strong>EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML y PDF</strong>{" "}
        directamente — no hay paso de conversión ni carga en la nube. El archivo que
        importas es el archivo que conservas; los subrayados, notas y tu posición se
        adjuntan al texto original.
      </p>
      <p>
        Los archivos protegidos con DRM no se pueden abrir — un libro comprado en una
        tienda que bloquea sus archivos sigue bloqueado. Si un libro se niega a abrirse
        y el formato es compatible, casi siempre es por eso.
      </p>

      <h2>Lee</h2>
      <p>
        Cada formato se abre en el mismo lector con los mismos controles. Tres modos de
        lectura están disponibles desde la configuración de apariencia del lector:
      </p>
      <ul>
        <li>
          <strong>Desplazamiento continuo</strong> — el modo predeterminado; el libro
          fluye como una columna.
        </li>
        <li>
          <strong>Página única</strong> — una página a la vez, pasada como papel.
        </li>
        <li>
          <strong>Dos páginas</strong> — un diseño tipo libro en pantallas anchas.
        </li>
      </ul>
      <p>
        Tu posición se guarda por libro, y la tabla de contenidos siempre está a un
        clic en la barra superior del lector.
      </p>
      <p>
        La misma configuración de apariencia controla la tipografía: fuente, tamaño,
        peso, interlineado, espaciado entre párrafos, márgenes y color de página. La
        alineación del texto predeterminada es <strong>Como publicado</strong> — lo que
        la hoja de estilos del propio libro solicitó — y se puede forzar a la izquierda
        o justificada si prefieres que sea uniforme en todas partes.
      </p>
      <p>
        Los libros de diseño fijo — PDFs y cómics — son páginas que alguien más ya
        compuso, por lo que no hay tipografía en ellos que cambiar y esos controles
        están ocultos. El color de página aún se aplica: uno claro tiñe el papel a
        medida que se dibuja la página, dejando cada tinta y fotografía como impresa, y
        uno oscuro redibuja la página en dos tonos para que el texto siga siendo
        legible. Establece <strong>Renderizado de página</strong> en{" "}
        <strong>Original</strong> para mantener un libro en sus propios colores —
        recordado por libro, para el arte y la fotografía donde el color es el punto.
      </p>

      <h2>Escucha</h2>
      <p>
        Cualquier libro se puede leer en voz alta. La lectura en voz alta utiliza el
        mismo navegador de oraciones y párrafos con el que lees — inicia el navegador,
        luego presiona reproducir en su barra, y el libro avanza una unidad a la vez
        con el texto hablado marcado mientras avanza.
      </p>
      <p>
        Por defecto esto habla con la propia voz de tu dispositivo, que no necesita
        clave ni red. Habilitar un plugin de voz — el plugin <strong>TTS Voices</strong>{" "}
        incluido, o cualquier otro — es en sí mismo la elección de hablar a través de
        ese motor; qué voz usa se configura en la propia configuración de ese plugin,
        junto con su proveedor y cualquier endpoint personalizado. No hay un selector
        de voz separado que mantener sincronizado.
      </p>

      <h2>Anota</h2>
      <p>Selecciona cualquier pasaje y aparece un menú de acción discreto:</p>
      <ul>
        <li>
          <strong>Subrayar</strong> — en algunos colores, o como subrayado.
        </li>
        <li>
          <strong>Nota</strong> — adjunta tus propias palabras al pasaje.
        </li>
        <li>
          <strong>Buscar</strong> — el diccionario integrado explica la palabra
          en su oración, no solo en abstracto, y la guarda en la línea de tiempo del
          Diccionario. (Usa tu IA configurada.)
        </li>
      </ul>
      <p>
        Todo lo que marcas se recopila por libro y alimenta la memoria de la aplicación —
        las anotaciones no son un archivo, son material que el asistente lee.
      </p>

      <h2>Conecta una IA</h2>
      <p>
        Toda la inteligencia de ReadAware funciona con una clave que tú aportas. Leer,
        anotar y la biblioteca funcionan completamente sin una; el asistente, el
        diccionario y la memoria la necesitan.
      </p>
      <ol>
        <li>Abre Ajustes → IA.</li>
        <li>
          Elige un proveedor — OpenAI, Anthropic, Google, OpenRouter, DeepSeek,
          xAI, Groq, Mistral, Moonshot, Z.ai, o cualquier endpoint compatible con
          OpenAI vía <strong>Personalizado</strong>.
        </li>
        <li>Pega tu clave de API y elige un modelo.</li>
      </ol>
      <p>
        ReadAware distingue un modelo <strong>inteligente</strong> (chat y síntesis)
        de uno <strong>rápido</strong> (búsquedas en diccionario, resúmenes,
        mantenimiento de memoria); se completan valores predeterminados sensibles por
        proveedor. Tu clave se almacena en tu dispositivo y las solicitudes van
        directamente a tu proveedor — no hay servidor de ReadAware en medio.
      </p>

      <h2>Pregunta</h2>
      <p>
        Cada libro tiene una conversación persistente — abre el panel de chat mientras
        lees y pregunta sobre el pasaje, el capítulo o el libro. En la página de{" "}
        <strong>Contexto</strong> puedes hablar a través de toda tu estantería en
        tantos hilos como quieras.
      </p>
      <p>
        El asistente trabaja desde tu lectura: tus subrayados, notas, conversaciones
        anteriores y una memoria a largo plazo que mantiene sobre lo que lees y te
        importa. Esa memoria se construye y almacena localmente, como todo lo demás.
      </p>

      <h2>Muévete rápido</h2>
      <p>
        La paleta de comandos (<code>Cmd K</code> en macOS, <code>Ctrl K</code>{" "}
        en otros — reasignable en Ajustes) alcanza cada acción: abrir libros,
        cambiar vistas, ejecutar comandos de plugins.
      </p>

      <h2>Dónde viven tus datos</h2>
      <p>
        Libros, anotaciones, conversaciones y memoria se almacenan en tu dispositivo. La
        red se usa para solicitudes de IA a tu propio proveedor — y, si conectas una
        cuenta de sincronización, un relé cifrado de extremo a extremo que mantiene tu
        biblioteca sincronizada entre dispositivos. La aplicación permanece totalmente
        utilizable sin conexión en ambos casos.
      </p>
      <p>
        La sincronización se mantiene fuera de vista mientras funciona: su progreso vive
        en Ajustes → Datos y Sincronización, y la ventana principal solo habla cuando
        algo falla — un error discreto que puedes silenciar por un día.
      </p>
    </article>
  );
}
