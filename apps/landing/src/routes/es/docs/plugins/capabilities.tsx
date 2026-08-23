import { createFileRoute } from "@tanstack/react-router";
import {
  PluginCapabilityBrowser,
  type PluginCapabilityBrowserCopy,
} from "../../../../components/PluginCapabilityBrowser";
import {
  PluginPermissionPreview,
  type PluginPermissionPreviewCopy,
} from "../../../../components/PluginPermissionPreview";

export const Route = createFileRoute("/es/docs/plugins/capabilities")({
  head: () => ({
    meta: [
      { title: "Capacidades de plugins — Documentación de ReadAware" },
      {
        name: "description",
        content:
          "Consulta todas las capacidades versionadas de plugins de ReadAware y previsualiza la autoridad solicitada por un manifest de plugin.",
      },
    ],
  }),
  component: PluginCapabilitiesPage,
});

const capabilityCopy: PluginCapabilityBrowserCopy = {
  searchLabel: "Buscar capacidades",
  searchPlaceholder: "ID, permiso o finalidad",
  familyLabel: "Familia de capacidades",
  authorityLabel: "Tipo de autoridad",
  allFamilies: "Todas las familias",
  allAuthorities: "Toda la autoridad",
  familyNames: {
    domains: "Dominios",
    contributions: "Contribuciones",
    services: "Servicios",
    schemas: "Esquemas",
  },
  authorityNames: {
    permission: "Permiso requerido",
    "permission-free": "Sin permiso adicional",
    "settings-grant": "Autorizaciones exactas de Ajustes",
  },
  permissionFree: "ninguna",
  versionLabel: "v",
  permissionLabel: "Autoridad",
  capabilityLabel: "Capacidad",
  purposeLabel: "El plugin puede",
  hostOwnsLabel: "El host conserva",
  result: (count) => `${count} ${count === 1 ? "capacidad" : "capacidades"}`,
  noResults: "Ninguna capacidad coincide con estos filtros.",
  descriptions: {
    "domains:library": {
      purpose: "Leer libros, archivos, metadatos, índices, colecciones e importar o eliminar elementos de la biblioteca.",
      hostOwns: "Invariantes de la biblioteca, escrituras basadas en eventos, archivos y proyecciones.",
    },
    "domains:reading": {
      purpose: "Inspeccionar la sesión activa y navegar, actualizar la ubicación, el progreso y el tiempo de lectura.",
      hostOwns: "Ciclo de vida del lector, semántica del progreso y eventos confirmados.",
    },
    "domains:annotations": {
      purpose: "Leer o cambiar resaltados y notas mediante comandos canónicos.",
      hostOwns: "Validación, atribución, persistencia y orden de eventos.",
    },
    "domains:conversations": {
      purpose: "Leer resúmenes de hilos de libros y globales.",
      hostOwns: "Escrituras de conversaciones, ensamblaje del contexto de instrucciones y memoria.",
    },
    "domains:settings": {
      purpose: "Descubrir, leer, actualizar y suscribirse a rutas de ajustes concedidas explícitamente.",
      hostOwns: "Catálogo, objetivos, validación, persistencia y efectos de cambios.",
    },
    "contributions:selectionActions": {
      purpose: "Añadir un comando a los menús de selección y anotaciones.",
      hostOwns: "Posición del menú, UI de invocación, carga y accesibilidad.",
    },
    "contributions:headerActions": {
      purpose: "Añadir una acción a la barra del lector o la biblioteca con una vista renderizada por el host.",
      hostOwns: "Posición, navegación, ventanas emergentes, páginas y foco.",
    },
    "contributions:commands": {
      purpose: "Añadir un comando explícito a la paleta de comandos.",
      hostOwns: "Registro, paleta, atajos y presentación de resultados.",
    },
    "contributions:settingsOptions": {
      purpose: "Resolver opciones dinámicas para un ajuste de plugin declarado.",
      hostOwns: "Renderizado del formulario, entrada alternativa y validación de valores.",
    },
    "contributions:voiceProviders": {
      purpose: "Enumerar voces y sintetizar audio codificado para la lectura en voz alta.",
      hostOwns: "Reproducción, ritmo, precarga, resaltado y alternativa.",
    },
    "contributions:contentProviders": {
      purpose: "Cargar secciones para libros virtuales como fuentes RSS.",
      hostOwns: "Vinculación con la biblioteca, modelo de lectura, navegación y presentación.",
    },
    "contributions:readerModes": {
      purpose: "Proporcionar segmentación acotada de frases o párrafos. Actualmente solo para plugins incluidos.",
      hostOwns: "Controles del lector, ciclo de vida, renderizado y navegación.",
    },
    "contributions:agentTools": {
      purpose: "Registrar una herramienta con espacio de nombres que el asistente de lectura pueda invocar.",
      hostOwns: "Orquestación, visibilidad de herramientas, aprobaciones e interfaz de la transcripción.",
    },
    "contributions:agentContextProviders": {
      purpose: "Devolver bloques de referencia acotados para el turno actual del usuario.",
      hostOwns: "Procedencia, recorte, posición del contexto de instrucciones y duración.",
    },
    "contributions:agentRetrievalProviders": {
      purpose: "Exponer una fuente del plugin consultable como herramienta del agente con espacio de nombres.",
      hostOwns: "Esquema de consulta, límites, recorte de resultados y descripción de la herramienta.",
    },
    "contributions:memoryCandidateProviders": {
      purpose: "Proponer hechos, preferencias, ideas o resúmenes después de un turno.",
      hostOwns: "Comprobaciones de ámbito, deduplicación, aceptación y escrituras duraderas de memoria.",
    },
    "contributions:themes": {
      purpose: "Proporcionar datos semánticos de temas de la aplicación y del lector.",
      hostOwns: "Validación, generación de CSS, selección y aplicación.",
    },
    "contributions:fonts": {
      purpose: "Proporcionar metadatos de fuentes aprobadas y recursos de fuentes incluidos.",
      hostOwns: "Validación de archivos, carga, entradas del selector y selección activa.",
    },
    "services:storage": {
      purpose: "Usar KV y colecciones de documentos del ámbito del plugin.",
      hostOwns: "Aislamiento de espacios de nombres, persistencia, instantáneas y eventos de cambios.",
    },
    "services:secrets": {
      purpose: "Guardar y recuperar credenciales de ranuras de secretos del ámbito del plugin.",
      hostOwns: "Cifrado, confidencialidad y aislamiento de espacios de nombres.",
    },
    "services:ui": {
      purpose: "Mostrar un aviso del host o abrir el flujo de guardado/exportación del host.",
      hostOwns: "Presentación, selección de ruta e integración con la plataforma.",
    },
    "services:schedules": {
      purpose: "Vincular el trabajo a una tarea recurrente declarada en el manifest.",
      hostOwns: "Cadencia, recuperación al iniciar, prevención de solapamientos y eliminación.",
    },
    "services:session": {
      purpose: "Suscribirse a hechos acotados de la sesión de lectura actual.",
      hostOwns: "Fuente de eventos, límites de la carga útil y ciclo de vida de la suscripción.",
    },
    "services:network": {
      purpose: "Realizar solicitudes HTTP mediante el cliente nativo del host.",
      hostOwns: "Aplicación de permisos, transporte y puente de respuestas.",
    },
    "services:llm": {
      purpose: "Realizar llamadas acotadas de una sola vez, de texto o estructuradas.",
      hostOwns: "Configuración del proveedor, credenciales, gestión del esquema y límites.",
    },
    "services:clipboard": {
      purpose: "Escribir texto en el portapapeles del sistema.",
      hostOwns: "Llamada de plataforma y aplicación de permisos.",
    },
    "schemas:views": {
      purpose: "Devolver markdown, listas, formularios, detalles y árboles de bloques acotados.",
      hostOwns: "Componentes, seguridad HTML, diseño, accesibilidad y navegación.",
    },
    "schemas:settings": {
      purpose: "Declarar campos de ajustes del plugin renderizados por el host.",
      hostOwns: "Comportamiento del formulario, validación, enrutamiento del almacenamiento y gestión de secretos.",
    },
    "schemas:themes": {
      purpose: "Declarar tokens semánticos de temas y metadatos de fuentes incluidas.",
      hostOwns: "Validación de la gramática, CSS generado, carga y selección.",
    },
  },
};

const permissionCopy: PluginPermissionPreviewCopy = {
  inputLabel: "manifest.json",
  inputHint: "Solo se analiza en esta página. No se sube nada.",
  previewLabel: "Vista previa de revisión",
  noAuthority: "Este manifest no solicita permisos semánticos ni autorizaciones de Ajustes.",
  invalidJson: "Introduce un objeto JSON válido.",
  issuesTitle: "Notas de revisión",
  permissionsTitle: "Autoridad del usuario · permisos semánticos",
  settingsTitle: "Autoridad del usuario · autorizaciones exactas de Ajustes",
  requirementsTitle: "Compatibilidad · no son permisos",
  declarationsTitle: "Declaraciones operativas · no son permisos",
  none: "Ninguna declarada",
  schemaVersion: "Esquema de datos privados",
  schedules: (count) => `${count} ${count === 1 ? "tarea recurrente" : "tareas recurrentes"}`,
  themes: (count) => `${count} ${count === 1 ? "tema" : "temas"}`,
  fonts: (count) => `${count} ${count === 1 ? "declaración de fuente incluida" : "declaraciones de fuentes incluidas"}`,
  unknownPermission: (permission) => `Permiso desconocido: ${permission}`,
  missingField: (field) => `Falta el campo obligatorio: ${field}`,
  invalidSchemaVersion: "schemaVersion debe ser un entero positivo.",
  invalidPermissions: "permissions debe ser un array.",
  invalidSettingsAccess: "settingsAccess debe ser un objeto.",
  unknownSettingsOperation: (operation) => `Operación de Ajustes desconocida: ${operation}`,
  invalidSettingsGrant: (operation) => `${operation} debe contener rutas exactas o grupos section.*.`,
  sectionGrantWarning: (path) => `${path} concede una sección completa de Ajustes; prefiere rutas exactas cuando sea posible.`,
  permissionDescriptions: {
    "library:read": "Leer libros, texto fuente, metadatos, índices y colecciones.",
    "library:write": "Cambiar la biblioteca; escribir incluye leer.",
    "reading:read": "Leer la sesión activa, la ubicación, el progreso y el tiempo de lectura.",
    "reading:write": "Navegar y cambiar el estado de lectura; escribir incluye leer.",
    "annotations:read": "Leer resaltados y notas.",
    "annotations:write": "Crear, editar y eliminar anotaciones; escribir incluye leer.",
    "conversations:read": "Leer resúmenes de conversaciones de libros y globales.",
    "reader:modes": "Registrar un modo de lectura guiada; actualmente solo para plugins incluidos.",
    "agent:tools": "Registrar herramientas que el asistente de lectura pueda invocar.",
    "agent:context": "Añadir bloques de referencia no confiables y acotados a un turno.",
    "agent:retrieval": "Exponer al asistente una fuente del plugin que se pueda consultar.",
    "agent:memory": "Proponer candidatos de memoria persistente revisados por el host.",
    "ui:themes": "Proporcionar temas de la aplicación, temas del lector y fuentes incluidas.",
    "service:network": "Realizar solicitudes de red mediadas por el host.",
    "service:llm": "Usar el modelo configurado para llamadas acotadas de una sola vez.",
    "service:clipboard": "Escribir texto en el portapapeles del sistema.",
  },
  operationLabels: { discover: "Descubrir", read: "Leer", write: "Escribir" },
  familyLabels: {
    domains: "Dominio",
    contributions: "Contribución",
    services: "Servicio",
    schemas: "Esquema",
  },
};

const sampleManifest = `{
  "id": "research-notes",
  "name": "Notas de investigación",
  "version": "0.1.0",
  "schemaVersion": 1,
  "requires": {
    "domains": {
      "annotations": "^1.0.0",
      "settings": "^1.0.0"
    },
    "contributions": {
      "commands": "^1.0.0",
      "agentRetrievalProviders": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "network": "^1.0.0"
    },
    "schemas": {
      "settings": "^1.0.0"
    }
  },
  "permissions": [
    "annotations:read",
    "agent:retrieval",
    "service:network"
  ],
  "settingsAccess": {
    "discover": ["appearance.theme"],
    "read": ["appearance.theme"]
  },
  "schedules": [
    {
      "id": "refresh",
      "label": "Actualizar fuentes",
      "everyMinutes": 60
    }
  ],
  "main": "main.js"
}`;

function PluginCapabilitiesPage() {
  return (
    <article className="doc-prose">
      <h1>Navegador de capacidades</h1>
      <p className="lead">
        Consulta el catálogo público completo antes de diseñar un plugin. Cada
        capacidad tiene su propia versión; cada dependencia pertenece a la{" "}
      <code>requires</code> del manifest.
      </p>

      <PluginCapabilityBrowser copy={capabilityCopy} />

      <h2>Cómo leer el catálogo</h2>
      <ul>
        <li><strong>Autoridad</strong> indica el permiso o la autorización exacta de Ajustes necesaria al invocar.</li>
        <li><strong>Ninguno</strong> significa que no hace falta un permiso de instalación adicional, no que exista una capacidad ambiental no documentada.</li>
        <li><strong>El host conserva</strong> marca el límite que el plugin no puede reemplazar ni eludir.</li>
        <li>La versión junto a cada entrada procede directamente del catálogo canónico de capacidades del host.</li>
      </ul>
      <p>
        <code>readerModes</code> sigue restringido a plugins incluidos mientras
        mientras se establece su contrato privilegiado de lector. Un manifest solo puede nombrar
        capacidades catalogadas; el host filtra la vista de ejecución visible
        por actor, permiso, versión y fase del ciclo de vida.
      </p>

      <h2>Vista previa de permisos</h2>
      <p>
        Pega un manifest para separar la autoridad del usuario de las declaraciones de
        compatibilidad y operación. Esto refleja el significado del consentimiento de
        instalación; no sustituye al validador del repositorio ni demuestra que un
        plugin pueda activarse.
      </p>

      <PluginPermissionPreview copy={permissionCopy} sampleManifest={sampleManifest} />

      <h2>Qué concede realmente el diálogo de instalación</h2>
      <p>
        Las entradas semánticas de <code>permissions</code> y las entradas exactas de{" "}
        <code>settingsAccess</code> conceden autoridad. El diálogo de consentimiento de la
        aplicación muestra ambas en lenguaje sencillo. Los requisitos de capacidades, las tareas
        programadas, la versión del esquema, los temas y las fuentes son contexto útil para la
        revisión, pero no se renombran silenciosamente como permisos.
      </p>
      <p>
        Esta vista previa es deliberadamente local y sin estado. El siguiente paso de las herramientas
        de desarrollo es una vista del actor y un inspector del ciclo de vida dentro de la aplicación, respaldados por
        los mismos catálogos de ejecución, con diferencias de permisos durante las actualizaciones y motivos exactos
        para las capacidades no disponibles.
      </p>
    </article>
  );
}
