import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/es/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "Sistema de plugins — Documentación de ReadAware" },
      {
        name: "description",
        content:
          "Qué pueden hacer los plugins de ReadAware, cómo funciona el modelo de confianza y cómo instalarlos.",
      },
    ],
  }),
  component: PluginsOverviewPage,
});

function PluginsOverviewPage() {
  return (
    <article className="doc-prose">
      <h1>Sistema de plugins</h1>
      <p className="lead">
        Los plugins extienden ReadAware con nuevas acciones, páginas y — lo más
        importante — nuevas herramientas para el asistente de lectura. Un plugin es un
        pequeño módulo JavaScript; su interfaz siempre es renderizada por el propio
        sistema de diseño de la aplicación, por lo que las funciones de los plugins lucen
        y se sienten nativas.
      </p>

      <h2>Lo que un plugin puede contribuir</h2>
      <ul>
        <li>
          <strong>Acciones de selección</strong> — entradas en el menú de selección de
          texto del lector. Envía una palabra a Anki, traduce un pasaje, guarda una
          cita en cualquier lugar.
        </li>
        <li>
          <strong>Botones de encabezado</strong> — botones de iconos en la barra
          superior del lector o de la estantería que abren un popover, o (en la
          estantería) una página completa.
        </li>
        <li>
          <strong>Comandos</strong> — entradas en la paleta de comandos. Cada acción de
          plugin es alcanzable allí automáticamente; los comandos explícitos agregan más.
        </li>
        <li>
          <strong>Herramientas de agente</strong> — funciones que el asistente de
          lectura puede llamar durante el chat. Este es el punto de montaje de mayor
          potencial: un plugin puede permitir que el asistente consulte tu mazo de Anki,
          tu acumulación de RSS, o cualquier servicio que uses.
        </li>
        <li>
          <strong>Proveedores de contenido</strong> — libros virtuales cuyos capítulos
          el plugin suministra bajo demanda. Un feed RSS puede sentarse en tu estantería
          y ser leído, anotado y discutido como cualquier libro.
        </li>
        <li>
          <strong>Voces de lectura en voz alta</strong> — motores TTS para la lectura en
          voz alta del lector. El plugin sintetiza audio; la aplicación posee la
          reproducción y vuelve a la voz del sistema cuando una llamada falla.
        </li>
        <li>
          <strong>Configuración y horarios</strong> — la configuración declarada se
          convierte en la propia sección del plugin en Ajustes (claves de API incluidas,
          almacenadas cifradas), y los horarios declarados ejecutan trabajo recurrente
          mientras la aplicación está abierta.
        </li>
      </ul>

      <h2>Los plugins lucen nativos, por construcción</h2>
      <p>
        Los plugins nunca renderizan su propio HTML. Declaran vistas desde un pequeño
        vocabulario — markdown, listas, formularios y algunos bloques estructurados — y
        la aplicación las renderiza con sus propios componentes. Los autores de plugins
        renuncian al control de píxeles y obtienen cero trabajo de diseño y una
        aplicación permanentemente consistente a cambio.
      </p>

      <h2>El modelo de confianza</h2>
      <p>
        Los plugins se ejecutan dentro de la aplicación con el mismo contexto JavaScript
        — como Obsidian, y a diferencia de un sandbox de extensión de navegador. Se
        aplican dos capas honestas de protección:
      </p>
      <ul>
        <li>
          <strong>Permisos</strong> — el manifest de un plugin declara lo que usa (red,
          datos de lectura, IA, portapapeles, …), y la API solo expone lo que fue
          declarado. Esto protege contra excesos accidentales.
        </li>
        <li>
          <strong>La instalación es la decisión de confianza.</strong> Antes de que se
          copie o ejecute nada, la aplicación muestra exactamente qué permisos solicita
          el plugin, en lenguaje claro, y espera tu consentimiento. Instala plugins de
          la misma manera que instalarías software.
        </li>
      </ul>
      <p>
        La propia arquitectura de la aplicación delimita el radio de explosión: el
        almacenamiento de plugins está en espacios de nombres dentro del directorio de
        datos de la aplicación, y la carcasa de escritorio no otorga acceso arbitrario
        al sistema de archivos.
      </p>

      <h2>Instalación de plugins</h2>
      <ul>
        <li>
          <strong>Mercado</strong> — Ajustes → Plugins → Mercado lista plugins
          de la comunidad del{" "}
          <a
            href={MARKETPLACE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            registro
          </a>{" "}
          público; la instalación es de un clic, con el resumen de permisos primero.
        </li>
        <li>
          <strong>Desde una carpeta</strong> — Ajustes → Plugins puede instalar
          cualquier carpeta de plugin local. Este es el ciclo de desarrollo: apúntalo a
          tu directorio de trabajo, reinstala para recoger cambios.
        </li>
      </ul>

      <h2>Tú controlas el diseño</h2>
      <p>
        Los plugins contribuyen capacidades; tú decides dónde viven los botones. Ajustes
        → Personalizar organiza cada superficie (barra superior de la estantería, barra
        superior del lector, menú de selección): arrastra elementos entre la fila
        visible y el menú de desbordamiento, reordénalos o restablece los valores
        predeterminados. Las nuevas acciones de plugins llegan al menú de desbordamiento
        — discretamente — y todo siempre es alcanzable desde la paleta de comandos.
      </p>

      <h2 id="read-aloud-tts">Lee en voz alta con cualquier voz TTS</h2>
      <p>
        El plugin <strong>TTS Voices</strong> incluido enruta la lectura en voz alta a
        través del motor de tu elección — ElevenLabs, Fish Audio, OpenAI, o cualquier
        endpoint compatible con OpenAI (Kokoro, LocalAI, puentes de Edge TTS…). Todo
        vive en <strong>Ajustes → TTS Voices</strong>: elige un proveedor, y sus campos
        siguen — las claves de API van directamente al almacén secreto cifrado, y donde
        el proveedor puede enumerar voces el campo Voz se convierte en una lista (escribe
        un nombre tú mismo cuando no puede).
      </p>
      <p>
        Una configuración gratuita popular son las voces neuronales de Edge de Microsoft
        vía{" "}
        <a
          href="https://github.com/travisvn/openai-edge-tts"
          target="_blank"
          rel="noopener noreferrer"
        >
          openai-edge-tts
        </a>
        , un pequeño servidor local que habla la API de audio de OpenAI:
      </p>
      <ol>
        <li>
          Ejecuta el servidor localmente — por ejemplo{" "}
          <code>docker run -d -p 5050:5050 travisvn/openai-edge-tts</code> (no se
          requiere clave de API por defecto).
        </li>
        <li>
          En Ajustes → TTS Voices, establece Proveedor en{" "}
          <em>Personalizado / local (compatible con OpenAI)</em> y el endpoint en{" "}
          <code>http://127.0.0.1:5050/v1/audio/speech</code>.
        </li>
        <li>
          Elige una voz de la lista — la aplicación lee el catálogo del servidor, por lo
          que el conjunto completo de Edge (p. ej. <code>zh-CN-XiaoxiaoNeural</code>,{" "}
          <code>en-US-AriaNeural</code>) aparece junto a los alias de estilo OpenAI.
        </li>
      </ol>
      <p>
        Luego abre un libro e inicia la lectura en voz alta: las oraciones fluyen a
        través de tu voz elegida, la siguiente se precarga mientras la actual reproduce,
        y cualquier llamada fallida vuelve a la voz del sistema en lugar de detener la
        lectura.
      </p>

      <h2>Escribe uno</h2>
      <p>
        Un plugin es una carpeta con un <code>manifest.json</code> y un único{" "}
        <code>main.js</code>. La <Link to="/es/docs/plugins/api">referencia API</Link>{" "}
        cubre todo el contrato, y{" "}
        <Link to="/es/docs/plugins/publishing">Publicación</Link> muestra cómo enviarlo
        al Mercado.
      </p>
    </article>
  );
}
