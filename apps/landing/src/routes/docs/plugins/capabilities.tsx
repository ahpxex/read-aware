import { createFileRoute } from "@tanstack/react-router";
import {
  PluginCapabilityBrowser,
  type PluginCapabilityBrowserCopy,
} from "../../../components/PluginCapabilityBrowser";
import {
  PluginPermissionPreview,
  type PluginPermissionPreviewCopy,
} from "../../../components/PluginPermissionPreview";

export const Route = createFileRoute("/docs/plugins/capabilities")({
  head: () => ({
    meta: [
      { title: "Plugin capabilities — ReadAware Docs" },
      {
        name: "description",
        content:
          "Browse every versioned ReadAware plugin capability and preview the authority requested by a plugin manifest.",
      },
    ],
  }),
  component: PluginCapabilitiesPage,
});

const capabilityCopy: PluginCapabilityBrowserCopy = {
  searchLabel: "Search capabilities",
  searchPlaceholder: "ID, permission, or purpose",
  familyLabel: "Capability family",
  authorityLabel: "Authority type",
  allFamilies: "All families",
  allAuthorities: "All authority",
  familyNames: {
    domains: "Domains",
    contributions: "Contributions",
    services: "Services",
    schemas: "Schemas",
  },
  authorityNames: {
    permission: "Permission required",
    "permission-free": "No extra permission",
    "settings-grant": "Exact Settings grants",
  },
  permissionFree: "none",
  versionLabel: "v",
  permissionLabel: "Authority",
  capabilityLabel: "Capability",
  purposeLabel: "Plugin can",
  hostOwnsLabel: "Host keeps",
  result: (count) => `${count} ${count === 1 ? "capability" : "capabilities"}`,
  noResults: "No capability matches these filters.",
  descriptions: {
    "domains:library": {
      purpose: "Read books, files, metadata, TOCs, collections, and import or remove library items.",
      hostOwns: "Library invariants, event-sourced writes, files, and projections.",
    },
    "domains:reading": {
      purpose: "Inspect the active session and navigate, update location, progress, and reading time.",
      hostOwns: "Reader lifecycle, progress semantics, and committed events.",
    },
    "domains:annotations": {
      purpose: "Read or change highlights and notes through canonical commands.",
      hostOwns: "Validation, attribution, persistence, and event ordering.",
    },
    "domains:conversations": {
      purpose: "Read book and global thread summaries.",
      hostOwns: "Conversation writes, prompt assembly, and memory.",
    },
    "domains:settings": {
      purpose: "Discover, read, update, and subscribe to explicitly granted setting paths.",
      hostOwns: "Catalog, targets, validation, persistence, and change effects.",
    },
    "contributions:selectionActions": {
      purpose: "Add a command to selection and annotation menus.",
      hostOwns: "Menu placement, invocation UI, loading, and accessibility.",
    },
    "contributions:headerActions": {
      purpose: "Add a reader or library toolbar action with a host-rendered view.",
      hostOwns: "Placement, navigation, popovers, pages, and focus.",
    },
    "contributions:commands": {
      purpose: "Add an explicit command-palette command.",
      hostOwns: "Registry, palette, shortcuts, and result presentation.",
    },
    "contributions:settingsOptions": {
      purpose: "Resolve dynamic options for one declared plugin setting.",
      hostOwns: "Form rendering, fallback input, and value validation.",
    },
    "contributions:voiceProviders": {
      purpose: "List voices and synthesize encoded audio for read-aloud.",
      hostOwns: "Playback, pacing, prefetch, highlighting, and fallback.",
    },
    "contributions:contentProviders": {
      purpose: "Load sections for virtual books such as RSS feeds.",
      hostOwns: "Library binding, reading model, navigation, and presentation.",
    },
    "contributions:readerModes": {
      purpose: "Supply bounded sentence or paragraph segmentation. Currently bundled-only.",
      hostOwns: "Reader controls, lifecycle, rendering, and navigation.",
    },
    "contributions:agentTools": {
      purpose: "Register a namespaced tool the reading assistant may call.",
      hostOwns: "Orchestration, tool visibility, approvals, and transcript UI.",
    },
    "contributions:agentContextProviders": {
      purpose: "Return bounded reference blocks for the current user turn.",
      hostOwns: "Provenance, clipping, prompt placement, and lifetime.",
    },
    "contributions:agentRetrievalProviders": {
      purpose: "Expose a searchable plugin-owned source as a namespaced agent tool.",
      hostOwns: "Query schema, limits, result clipping, and tool description.",
    },
    "contributions:memoryCandidateProviders": {
      purpose: "Propose facts, preferences, insights, or summaries after a turn.",
      hostOwns: "Scope checks, deduplication, acceptance, and durable memory writes.",
    },
    "contributions:themes": {
      purpose: "Supply semantic app and reader theme data.",
      hostOwns: "Validation, CSS generation, selection, and application.",
    },
    "contributions:fonts": {
      purpose: "Supply approved font metadata and bundled font assets.",
      hostOwns: "File validation, loading, picker entries, and active selection.",
    },
    "services:storage": {
      purpose: "Use plugin-scoped KV and document collections.",
      hostOwns: "Namespace isolation, persistence, snapshots, and change events.",
    },
    "services:secrets": {
      purpose: "Store and retrieve credentials from plugin-scoped secret slots.",
      hostOwns: "Encryption, non-disclosure, and namespace isolation.",
    },
    "services:ui": {
      purpose: "Show a host toast or open the host save/export flow.",
      hostOwns: "Presentation, path choice, and platform integration.",
    },
    "services:schedules": {
      purpose: "Bind work to a recurring task declared in the manifest.",
      hostOwns: "Cadence, launch catch-up, overlap prevention, and disposal.",
    },
    "services:session": {
      purpose: "Subscribe to bounded facts about the current reading session.",
      hostOwns: "Event source, payload bounds, and subscription lifecycle.",
    },
    "services:network": {
      purpose: "Make HTTP requests through the native host client.",
      hostOwns: "Permission enforcement, transport, and response bridge.",
    },
    "services:llm": {
      purpose: "Make bounded one-shot text or structured model calls.",
      hostOwns: "Provider configuration, credentials, schema handling, and limits.",
    },
    "services:clipboard": {
      purpose: "Write text to the system clipboard.",
      hostOwns: "Platform call and permission enforcement.",
    },
    "schemas:views": {
      purpose: "Return markdown, lists, forms, details, and bounded block trees.",
      hostOwns: "Components, HTML safety, layout, accessibility, and navigation.",
    },
    "schemas:settings": {
      purpose: "Declare host-rendered plugin setting fields.",
      hostOwns: "Form behavior, validation, storage routing, and secret handling.",
    },
    "schemas:themes": {
      purpose: "Declare semantic theme tokens and bundled font metadata.",
      hostOwns: "Grammar validation, generated CSS, loading, and selection.",
    },
  },
};

const permissionCopy: PluginPermissionPreviewCopy = {
  inputLabel: "manifest.json",
  inputHint: "Parsed only in this page. Nothing is uploaded.",
  previewLabel: "Review preview",
  noAuthority: "This manifest requests no semantic permissions or Settings grants.",
  invalidJson: "Enter a valid JSON object.",
  issuesTitle: "Review notes",
  permissionsTitle: "User authority · semantic permissions",
  settingsTitle: "User authority · exact Settings grants",
  requirementsTitle: "Compatibility · not permissions",
  declarationsTitle: "Operational declarations · not permissions",
  none: "None declared",
  schemaVersion: "Private data schema",
  schedules: (count) => `${count} recurring ${count === 1 ? "task" : "tasks"}`,
  themes: (count) => `${count} ${count === 1 ? "theme" : "themes"}`,
  fonts: (count) => `${count} bundled font ${count === 1 ? "declaration" : "declarations"}`,
  unknownPermission: (permission) => `Unknown permission: ${permission}`,
  missingField: (field) => `Missing required field: ${field}`,
  invalidSchemaVersion: "schemaVersion must be a positive integer.",
  invalidPermissions: "permissions must be an array.",
  invalidSettingsAccess: "settingsAccess must be an object.",
  unknownSettingsOperation: (operation) => `Unknown Settings operation: ${operation}`,
  invalidSettingsGrant: (operation) => `${operation} must contain exact paths or section.* groups.`,
  sectionGrantWarning: (path) => `${path} grants a whole Settings section; prefer exact paths when possible.`,
  permissionDescriptions: {
    "library:read": "Read books, source text, metadata, TOCs, and collections.",
    "library:write": "Change the library; write includes read.",
    "reading:read": "Read the active session, location, progress, and reading time.",
    "reading:write": "Navigate and change reading state; write includes read.",
    "annotations:read": "Read highlights and notes.",
    "annotations:write": "Create, edit, and remove annotations; write includes read.",
    "conversations:read": "Read book and global conversation summaries.",
    "reader:modes": "Register a guided reader mode; currently bundled-only.",
    "agent:tools": "Register tools the reading assistant may call.",
    "agent:context": "Add bounded untrusted reference blocks to one turn.",
    "agent:retrieval": "Expose a searchable plugin source to the assistant.",
    "agent:memory": "Propose host-reviewed durable memory candidates.",
    "ui:themes": "Supply app themes, reader themes, and bundled fonts.",
    "service:network": "Make host-mediated network requests.",
    "service:llm": "Use the configured model for bounded one-shot calls.",
    "service:clipboard": "Write text to the system clipboard.",
  },
  operationLabels: { discover: "Discover", read: "Read", write: "Write" },
  familyLabels: {
    domains: "Domain",
    contributions: "Contribution",
    services: "Service",
    schemas: "Schema",
  },
};

const sampleManifest = `{
  "id": "research-notes",
  "name": "Research Notes",
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
      "label": "Refresh sources",
      "everyMinutes": 60
    }
  ],
  "main": "main.js"
}`;

function PluginCapabilitiesPage() {
  return (
    <article className="doc-prose">
      <h1>Capability browser</h1>
      <p className="lead">
        Search the complete public catalog before designing a plugin. Every
        capability is independently versioned; every dependency belongs in the{" "}
        <code>requires</code> section of the manifest.
      </p>

      <PluginCapabilityBrowser copy={capabilityCopy} />

      <h2>How to read the catalog</h2>
      <ul>
        <li><strong>Authority</strong> names the permission or exact Settings grant needed at invocation time.</li>
        <li><strong>None</strong> means no extra installation permission, not an undocumented ambient power.</li>
        <li><strong>Host keeps</strong> marks the boundary the plugin cannot replace or bypass.</li>
        <li>The version beside each entry comes directly from the host's canonical capability catalog.</li>
      </ul>
      <p>
        <code>readerModes</code> remains restricted to bundled plugins while
        its privileged reader contract settles. A manifest may name only
        cataloged capabilities; the host still filters the visible runtime
        view by actor, permission, version, and lifecycle phase.
      </p>

      <h2>Permission preview</h2>
      <p>
        Paste a manifest to separate user authority from compatibility and
        operational declarations. This mirrors the meaning of installation
        consent; it does not replace the repository validator or prove that a
        plugin can activate.
      </p>

      <PluginPermissionPreview copy={permissionCopy} sampleManifest={sampleManifest} />

      <h2>What the install dialog actually grants</h2>
      <p>
        Semantic <code>permissions</code> and exact <code>settingsAccess</code>{" "}
        entries grant authority. The shipping consent dialog shows both in
        plain language. Capability requirements, schedules, schema version,
        themes, and fonts are useful review context, but they are not silently
        relabeled as permissions.
      </p>
      <p>
        This preview is intentionally local and stateless. The next developer
        tooling step is an in-app actor-view and lifecycle inspector backed by
        the same runtime catalogs, with update-time permission diffs and exact
        reasons for unavailable capabilities.
      </p>
    </article>
  );
}
