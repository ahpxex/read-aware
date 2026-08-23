import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/es/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "Sistema de plugins — Documentación de ReadAware" },
      {
        name: "description",
        content:
          "Cómo los plugins de ReadAware amplían los dominios del producto, aportan nuevas capacidades, usan servicios del host y permanecen dentro de límites de confianza explícitos.",
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
        Los plugins de ReadAware pueden trabajar con datos de lectura, añadir
        acciones y proveedores nativos, ampliar el asistente de lectura y
        solicitar servicios acotados al host. Los paquetes instalados se cargan
        dinámicamente; la aplicación nunca necesita un interruptor para cada ID
        de plugin.
      </p>

      <h2>Un modelo, tres familias de capacidades</h2>
      <p>
        Cada capacidad ejecutable de plugin adopta una de tres formas. Elegir la
        forma adecuada es la primera decisión al crear un plugin.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr><th>Familia</th><th>Úsala cuando</th><th>Ejemplos</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Dominio</strong></td>
              <td>ReadAware ya es propietario del estado o comportamiento.</td>
              <td>Biblioteca, lectura, anotaciones, conversaciones, ajustes</td>
            </tr>
            <tr>
              <td><strong>Contribución</strong></td>
              <td>El plugin proporciona una nueva opción o implementación.</td>
              <td>Acciones, comandos, voces, contenido, temas, proveedores del agente</td>
            </tr>
            <tr>
              <td><strong>Servicio</strong></td>
              <td>El host debe realizar una operación externa acotada.</td>
              <td>Almacenamiento, secretos, tareas programadas, red, LLM, portapapeles</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Los esquemas declarativos de vistas, ajustes y temas acompañan a estas
        familias. Describen datos renderizados por el host; no conceden otra
        fuente de autoridad.
      </p>

      <h2>Los ajustes son un dominio</h2>
      <p>
        Apariencia es una sección de Ajustes, no una API de plugin separada. Un
        plugin que cambia el tema seleccionado solicita rutas exactas de Ajustes
        como <code>appearance.theme</code>. Un plugin que proporciona un tema
        nuevo usa la contribución <code>themes</code>. Elegir y proporcionar son
        poderes deliberadamente separados.
      </p>

      <h2>Qué pueden añadir los plugins</h2>
      <ul>
        <li>Acciones de selección y cabecera, comandos de la paleta y vistas renderizadas por el host.</li>
        <li>Voces, proveedores de contenido de libros virtuales, modos de lectura, temas y fuentes.</li>
        <li>Herramientas del agente, contexto por turno, fuentes privadas consultables y candidatos de memoria.</li>
        <li>Ajustes del plugin, opciones dinámicas, tareas recurrentes, almacenamiento y secretos cifrados.</li>
        <li>Lecturas, comandos y suscripciones a eventos confirmados en los dominios de producto concedidos.</li>
      </ul>
      <p>
        Consulta el catálogo completo y versionado en el{" "}
        <Link to="/es/docs/plugins/capabilities">navegador de capacidades</Link>.
        También incluye una vista previa de permisos para <code>manifest.json</code>.
      </p>

      <h2>UI nativa, por diseño</h2>
      <p>
        Los plugins no montan React, HTML, CSS, iframes ni DOM arbitrario.
        Devuelven datos de vista validados y callbacks; ReadAware se encarga del
        diseño, la navegación, la accesibilidad, la compatibilidad de temas, los
        estados de carga y la limpieza. La nueva libertad visual llega como un
        esquema acotado o un punto real de contribución del host, no como una
        vía de escape genérica mediante webview.
      </p>

      <h2>El límite de confianza</h2>
      <p>
        Cada plugin se ejecuta en su propio Worker de módulos. No tiene acceso al
        DOM, Tauri, SQLite, al sistema de archivos ni a identificadores de
        procesos, y las API de red ambiental y persistencia del navegador están
        desactivadas. Las llamadas al host cruzan un límite de mensajes y se
        resuelven según la vista de capacidades del plugin delimitada por actor.
      </p>
      <p>
        Esto limita los excesos accidentales y directos, pero instalar software
        sigue siendo una decisión de confianza. Antes de ejecutar el código,
        ReadAware muestra los permisos semánticos y las concesiones exactas de
        Ajustes. Los requisitos de capacidades se comprueban por separado: un
        permiso responde «¿puede hacer esto?», mientras que un requisito de
        versión responde «¿puede usar correctamente este contrato?».
      </p>

      <h2>La activación y las actualizaciones son transaccionales</h2>
      <p>
        <code>activate()</code> es una fase de lectura y declaración. Los
        registros permanecen invisibles mientras el host procesa las llamadas y
        comprueba la salud del Worker; las escrituras, los secretos, la red, el
        LLM, el portapapeles, los efectos de UI y la navegación están bloqueados.
        Los cambios de datos persistentes se ejecutan después mediante un
        <code>migrate()</code> limitado al almacenamiento. Solo se promociona un
        candidato saludable y migrado.
      </p>
      <p>
        Las actualizaciones toman instantáneas de los archivos, el KV del plugin,
        las colecciones de documentos y los metadatos de esquema confirmados. Si
        falla la activación o la migración, se restauran los archivos y datos
        anteriores y se reinicia el runtime previo cuando es necesario.
      </p>

      <h2>Ecosistema actual</h2>
      <p>
        Los plugins distribuidos actualmente son integrados o propios: Dictionary,
        Editorial Themes, RSS Reader, Sentence Reader, TTS Voices y Theme
        Schedule. El{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
        repositorio readaware-plugins
        </a>{" "}
        contiene la plantilla de creación, las declaraciones públicas, la
        validación y el registro del marketplace. No hay ninguna API de terceros
        heredada que preservar; el contrato actual es la base.
      </p>

      <h2>Empezar a crear</h2>
      <p>
        Sigue <Link to="/es/docs/plugins/develop">Crear un plugin</Link> para el
        ciclo local, usa la <Link to="/es/docs/plugins/api">referencia de la API</Link>{" "}
        durante la implementación y lee{" "}
        <Link to="/es/docs/plugins/publishing">Publicación</Link> antes de enviar
        un cambio al marketplace.
      </p>
    </article>
  );
}
