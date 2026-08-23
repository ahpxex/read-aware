import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../../lib/site";

export const Route = createFileRoute("/es/docs/plugins/develop")({
  head: () => ({
    meta: [
      { title: "Crear un plugin — Documentación de ReadAware" },
      {
        name: "description",
        content:
          "Crea, valida, instala, migra y prueba un plugin de ReadAware con la plantilla pública de TypeScript.",
      },
    ],
  }),
  component: DevelopPluginPage,
});

function DevelopPluginPage() {
  return (
    <article className="doc-prose">
      <h1>Crear un plugin</h1>
      <p className="lead">
        Empieza con la plantilla pública de TypeScript, declara el conjunto
        mínimo de capacidades y prueba el paquete compilado en la aplicación
        de escritorio de ReadAware. El host se encarga del ciclo de vida, los
        permisos, la presentación y la reversión; tu plugin se encarga de su
        comportamiento y sus datos privados.
      </p>

      <h2>Requisitos previos</h2>
      <ul>
        <li>La aplicación de escritorio de ReadAware, con acceso a Ajustes → Plugins.</li>
        <li><a href="https://bun.sh" target="_blank" rel="noopener noreferrer">Bun</a> para los scripts del repositorio.</li>
        <li>Un clon o fork del{" "}
          <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">repositorio readaware-plugins</a>.
        </li>
      </ul>

      <h2>Crear el paquete</h2>
      <ol>
        <li>Copia <code>template/</code> en <code>plugins/&lt;your-plugin-id&gt;/</code>.</li>
        <li>Mantén idénticos el nombre de la carpeta, el <code>id</code> del manifest y el espacio de nombres del runtime.</li>
        <li>Edita <code>manifest.json</code> y <code>src/main.ts</code>.</li>
        <li>Elimina las contribuciones de la plantilla que no uses y quita sus permisos.</li>
        <li>Compila el <code>main.js</code> autocontenido que carga ReadAware.</li>
      </ol>
      <pre><code>{`bun run build
bun run typecheck
bun test
bun run validate`}</code></pre>

      <h2>Diseña el manifest antes de implementar</h2>
      <p>Revisa el manifest en este orden:</p>
      <ol>
        <li><strong>Identidad</strong> — ID estable, nombre, versión del paquete, autor y versión mínima de la aplicación.</li>
        <li><strong>Datos</strong> — entero positivo <code>schemaVersion</code> y ruta de migración.</li>
        <li><strong>Compatibilidad</strong> — un rango semver en <code>requires</code> para cada API y esquema utilizado.</li>
        <li><strong>Autoridad</strong> — <code>permissions</code> semánticos y concesiones exactas de <code>settingsAccess</code>.</li>
        <li><strong>Declaraciones</strong> — ajustes, tareas programadas, temas, fuentes y módulo de entrada.</li>
      </ol>
      <p>
        Usa el <Link to="/es/docs/plugins/capabilities">navegador de capacidades y la vista previa de permisos</Link>{" "}
        antes de instalar. Los requisitos son afirmaciones de compatibilidad,
        no autoridad del usuario; las capacidades sin permisos también deben
        figurar en <code>requires</code> cuando tu plugin depende de su contrato.
      </p>

      <h2>Elegir la capacidad adecuada</h2>
      <ol>
        <li>Usa un <strong>Dominio</strong> para el estado o comportamiento que pertenece a ReadAware.</li>
        <li>Usa una <strong>Contribución</strong> para proporcionar una opción, acción o proveedor.</li>
        <li>Usa un <strong>Servicio</strong> para una operación acotada del host.</li>
        <li>Usa el almacenamiento del plugin únicamente para datos propios del plugin.</li>
        <li>Solicita una nueva capacidad tipada del host cuando ninguna forma existente encaje.</li>
      </ol>
      <p>
        No dupliques libros, progreso, anotaciones, Ajustes ni memoria en el
        almacenamiento del plugin. El estado paralelo evita las invariantes
        del producto, los eventos confirmados, la reconstrucción de
        proyecciones, la semántica de sincronización y el contexto del agente.
      </p>

      <h2>Mantener la activación declarativa</h2>
      <p>
        Durante <code>activate(ctx)</code>, inspecciona el entorno y registra
        acciones, comandos, proveedores, suscripciones y tareas programadas.
        No realices escrituras de negocio ni trabajo externo. El host prepara
        cada registro hasta que terminan las RPC de activación y el Worker
        responde a un ping de salud.
      </p>
      <p>
        Inicia el trabajo del runtime desde un manejador registrado después de
        la promoción. Si un manejador devuelve una promesa, deja que el host
        presente los estados de carga y error. Conserva referencias a recursos
        externos solo cuando tu <code>deactivate()</code> opcional deba
        cerrarlos; los registros y las suscripciones del host se eliminan
        automáticamente.
      </p>

      <h2>Versionar los datos privados explícitamente</h2>
      <p>
        <code>schemaVersion</code> versiona el KV y las colecciones de
        documentos del plugin; es independiente de la versión del paquete.
        Cámbialo únicamente cuando cambie la forma de los datos privados.
        Exporta <code>migrate(storageCtx, change)</code> para cada actualización
        y degradación compatibles después de confirmar un esquema.
      </p>
      <ul>
        <li>Las migraciones solo reciben almacenamiento: no dominios, Ajustes, secretos, red, UI, LLM ni contribuciones.</li>
        <li>Haz que cada transición sea determinista e idempotente.</li>
        <li>Prueba un fallo después de escrituras parciales; el host debe restaurar exactamente el KV, los documentos, los archivos y los metadatos del esquema.</li>
        <li>No uses una comprobación de la versión del paquete como sustituto del esquema de datos.</li>
      </ul>

      <h2>Instalar la carpeta de trabajo</h2>
      <ol>
        <li>Ejecuta la compilación y las comprobaciones.</li>
        <li>Abre ReadAware → Ajustes → Plugins → Instalar plugin.</li>
        <li>Selecciona la carpeta del plugin compilado e inspecciona el resumen del consentimiento.</li>
        <li>Prueba la funcionalidad real en la aplicación de escritorio.</li>
        <li>Vuelve a compilar y reinstala para probar una actualización.</li>
      </ol>
      <p>
        Un navegador convencional no puede verificar la instalación del plugin,
        la IPC del Worker, la persistencia de SQLite, el acceso directo a libros,
        la integración con el lector ni la reversión. Prueba la aplicación Tauri
        distribuida.
      </p>

      <h2>Probar el ciclo de vida, no solo el camino feliz</h2>
      <ul>
        <li>Instalación nueva, activación, desactivación y reactivación sin reiniciar.</li>
        <li>Actualización y degradación correctas con datos reales.</li>
        <li>Tiempo de espera agotado durante la activación, rechazo del manejador, fallo de migración y reversión exacta.</li>
        <li>Limpieza al desinstalar: ninguna acción, escucha, tarea programada, proveedor o Worker superviviente.</li>
        <li>Eliminación y ampliación de permisos durante una actualización.</li>
        <li>Etiquetas largas, estados vacíos, navegación con teclado y todos los temas del host.</li>
      </ul>

      <h2>Conocer los límites actuales</h2>
      <p>
        Las tareas programadas se ejecutan mientras ReadAware está abierto, al
        menos con la cadencia declarada, y se ponen al día al iniciar cuando
        están atrasadas. No son trabajos duraderos: no se ejecutan mientras la
        aplicación está cerrada, no tienen una cola persistente, un contrato de
        reintento con backoff ni garantía de reanudación tras un fallo.
      </p>
      <p>
        La UI solo está disponible en los puntos de contribución tipados
        existentes. Una ubicación que falte requiere una contribución y un
        consumidor propiedad del host; no se añadirá HTML arbitrario ni una API
        genérica de invocación nativa como atajo.
      </p>

      <h2>Siguiente</h2>
      <p>
        Mantén la <Link to="/es/docs/plugins/api">referencia de la API</Link> junto a tu
        editor y después lee <Link to="/es/docs/plugins/publishing">Publicación</Link>{" "}
        antes de preparar un pull request para el registro.
      </p>
    </article>
  );
}
