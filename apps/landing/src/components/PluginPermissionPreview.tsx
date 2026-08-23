import { WarningCircle } from "@phosphor-icons/react";
import { PLUGIN_PERMISSIONS, type PluginPermission } from "@read-aware/core";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { JsonCodeEditor } from "./JsonCodeEditor";

type KnownPermission = PluginPermission;
type RequirementFamily = "domains" | "contributions" | "services" | "schemas";
type SettingsOperation = "discover" | "read" | "write";

const KNOWN_PERMISSION_SET = new Set<string>(PLUGIN_PERMISSIONS);
const SETTINGS_PATH = /^[a-z][a-zA-Z0-9-]*(?:\.[a-z][a-zA-Z0-9-]*)*(?:\.\*)?$/;
const REQUIREMENT_FAMILIES: RequirementFamily[] = [
  "domains",
  "contributions",
  "services",
  "schemas",
];
const SETTINGS_OPERATIONS: SettingsOperation[] = ["discover", "read", "write"];

export type PluginPermissionPreviewCopy = {
  inputLabel: string;
  inputHint: string;
  previewLabel: string;
  noAuthority: string;
  invalidJson: string;
  issuesTitle: string;
  permissionsTitle: string;
  settingsTitle: string;
  requirementsTitle: string;
  declarationsTitle: string;
  none: string;
  schemaVersion: string;
  schedules: (count: number) => string;
  themes: (count: number) => string;
  fonts: (count: number) => string;
  unknownPermission: (permission: string) => string;
  missingField: (field: string) => string;
  invalidSchemaVersion: string;
  invalidPermissions: string;
  invalidSettingsAccess: string;
  unknownSettingsOperation: (operation: string) => string;
  invalidSettingsGrant: (operation: string) => string;
  sectionGrantWarning: (path: string) => string;
  permissionDescriptions: Record<KnownPermission, string>;
  operationLabels: Record<SettingsOperation, string>;
  familyLabels: Record<RequirementFamily, string>;
};

type Preview = {
  permissions: string[];
  grants: Array<{ operation: SettingsOperation; path: string }>;
  requirements: Array<{ family: RequirementFamily; id: string; range: string }>;
  declarations: { schemaVersion: unknown; schedules: number; themes: number; fonts: number };
  issues: string[];
  warnings: string[];
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function inspectManifest(value: unknown, copy: PluginPermissionPreviewCopy): Preview {
  const manifest = recordOf(value);
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!manifest) {
    return {
      permissions: [], grants: [], requirements: [],
      declarations: { schemaVersion: undefined, schedules: 0, themes: 0, fonts: 0 },
      issues: [copy.invalidJson], warnings,
    };
  }

  for (const field of ["id", "name", "version", "requires"] as const) {
    if (manifest[field] == null || manifest[field] === "") issues.push(copy.missingField(field));
  }
  if (!Number.isInteger(manifest.schemaVersion) || Number(manifest.schemaVersion) < 1) {
    issues.push(copy.invalidSchemaVersion);
  }

  const permissions: string[] = [];
  if (manifest.permissions != null && !Array.isArray(manifest.permissions)) {
    issues.push(copy.invalidPermissions);
  } else {
    for (const permission of (manifest.permissions ?? []) as unknown[]) {
      const label = String(permission);
      permissions.push(label);
      if (!KNOWN_PERMISSION_SET.has(label)) issues.push(copy.unknownPermission(label));
    }
  }

  const grants: Preview["grants"] = [];
  if (manifest.settingsAccess != null) {
    const settingsAccess = recordOf(manifest.settingsAccess);
    if (!settingsAccess) {
      issues.push(copy.invalidSettingsAccess);
    } else {
      for (const operation of Object.keys(settingsAccess)) {
        if (!SETTINGS_OPERATIONS.includes(operation as SettingsOperation)) {
          issues.push(copy.unknownSettingsOperation(operation));
          continue;
        }
        const paths = settingsAccess[operation];
        if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string" || !SETTINGS_PATH.test(path))) {
          issues.push(copy.invalidSettingsGrant(operation));
          continue;
        }
        for (const path of paths as string[]) {
          grants.push({ operation: operation as SettingsOperation, path });
          if (path.endsWith(".*")) warnings.push(copy.sectionGrantWarning(path));
        }
      }
    }
  }

  const requirements: Preview["requirements"] = [];
  const requires = recordOf(manifest.requires);
  if (requires) {
    for (const family of REQUIREMENT_FAMILIES) {
      const entries = recordOf(requires[family]);
      if (!entries) continue;
      for (const [id, range] of Object.entries(entries)) {
        requirements.push({ family, id, range: String(range) });
      }
    }
  }

  return {
    permissions: [...new Set(permissions)],
    grants,
    requirements,
    declarations: {
      schemaVersion: manifest.schemaVersion,
      schedules: Array.isArray(manifest.schedules) ? manifest.schedules.length : 0,
      themes: Array.isArray(manifest.themes) ? manifest.themes.length : 0,
      fonts: Array.isArray(manifest.fonts) ? manifest.fonts.length : 0,
    },
    issues,
    warnings,
  };
}

export function PluginPermissionPreview({
  copy,
  sampleManifest,
}: {
  copy: PluginPermissionPreviewCopy;
  sampleManifest: string;
}) {
  const [source, setSource] = useState(sampleManifest);
  const parsed = useMemo(() => {
    try {
      return inspectManifest(JSON.parse(source), copy);
    } catch {
      return { error: copy.invalidJson } as const;
    }
  }, [copy, source]);

  return (
    <div data-doc-slot="permission-preview" className="mt-6 grid gap-5 border-y border-border-strong py-5 lg:grid-cols-2">
      <label className="block min-w-0">
        <span className="text-sm font-medium text-fg">{copy.inputLabel}</span>
        <span className="mt-1 block text-sm text-fg-muted">{copy.inputHint}</span>
        <JsonCodeEditor
          label={copy.inputLabel}
          value={source}
          onChange={setSource}
        />
      </label>

      <section aria-live="polite" className="min-w-0 lg:border-l lg:border-border lg:pl-5">
        <h3 className="!mt-0">{copy.previewLabel}</h3>
        {"error" in parsed ? (
          <p className="mt-3 flex gap-2 border-l-2 border-red-700 pl-3 text-sm text-red-800 dark:text-red-300">
            <WarningCircle aria-hidden="true" className="mt-1 shrink-0" size={18} />
            {parsed.error}
          </p>
        ) : (
          <>
            {(parsed.issues.length > 0 || parsed.warnings.length > 0) && (
              <div className="mt-3 border-l-2 border-border-strong pl-3 text-sm">
                <strong>{copy.issuesTitle}</strong>
                <ul className="!mt-1">
                  {[...parsed.issues, ...parsed.warnings].map((issue, index) => (
                    <li key={`${index}:${issue}`}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <PreviewGroup title={copy.permissionsTitle} empty={copy.none}>
              {parsed.permissions.map((permission) => (
                <li key={permission}>
                  <code>{permission}</code>
                  {KNOWN_PERMISSION_SET.has(permission) && (
                    <> — {copy.permissionDescriptions[permission as KnownPermission]}</>
                  )}
                </li>
              ))}
            </PreviewGroup>

            <PreviewGroup title={copy.settingsTitle} empty={copy.none}>
              {parsed.grants.map((grant) => (
                <li key={`${grant.operation}:${grant.path}`}>
                  {copy.operationLabels[grant.operation]} <code>{grant.path}</code>
                </li>
              ))}
            </PreviewGroup>

            <PreviewGroup title={copy.requirementsTitle} empty={copy.none}>
              {parsed.requirements.map((requirement) => (
                <li key={`${requirement.family}:${requirement.id}`}>
                  {copy.familyLabels[requirement.family]} <code>{requirement.id}</code>{" "}
                  <code>{requirement.range}</code>
                </li>
              ))}
            </PreviewGroup>

            <PreviewGroup title={copy.declarationsTitle} empty={copy.none}>
              <li>{copy.schemaVersion}: <code>{String(parsed.declarations.schemaVersion ?? "—")}</code></li>
              {parsed.declarations.schedules > 0 && <li>{copy.schedules(parsed.declarations.schedules)}</li>}
              {parsed.declarations.themes > 0 && <li>{copy.themes(parsed.declarations.themes)}</li>}
              {parsed.declarations.fonts > 0 && <li>{copy.fonts(parsed.declarations.fonts)}</li>}
            </PreviewGroup>

            {parsed.permissions.length === 0 && parsed.grants.length === 0 && (
              <p className="mt-4 border-l-2 border-border-strong pl-3 text-sm text-fg-muted">
                {copy.noAuthority}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function PreviewGroup({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const hasItems = Array.isArray(items) ? items.length > 0 : Boolean(items);
  return (
    <div className="mt-5">
      <strong className="text-sm">{title}</strong>
      {hasItems ? <ul className="!mt-1 text-sm">{items}</ul> : <p className="!mt-1 text-sm text-fg-muted">{empty}</p>}
    </div>
  );
}
