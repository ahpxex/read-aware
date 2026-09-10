import type { PluginContext } from "@read-aware/plugin-types";

export const LEGACY_PROFILE_PATHS = ["shelf.layout", "shelf.group", "shelf.sort", "appearance.theme", "appearance.motion", "reading.fontSize", "reading.lineSpacing"] as const;
export const PROFILE_PATHS = [...LEGACY_PROFILE_PATHS, "reading.fontFamily", "appearance.contentTypography.fontFamily", "appearance.contentTypography.followReader"] as const;
type Change = Parameters<PluginContext["domains"]["settings"]["commands"]["update"]>[0][number];
export type Profile = { version: 1 | 2; name: string; changes: Change[] };
export const profileCollection = (ctx: PluginContext) => ctx.services.storage.collection("profiles");
const invalid = (message: string): never => { throw Object.assign(Error(message), { code: "plugin/invalid-input" }); };

export function profileName(name: unknown): string {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) return invalid("Profile name must contain 1-80 characters");
  return name.trim();
}
export function parseProfile(value: unknown): Profile | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Profile;
  const paths: readonly string[] = profile.version === 1 ? LEGACY_PROFILE_PATHS : PROFILE_PATHS;
  if (![1, 2].includes(profile.version) || typeof profile.name !== "string" || !profile.name.trim() || profile.name.trim().length > 80
    || !Array.isArray(profile.changes) || profile.changes.length !== paths.length
    || profile.changes.some(change => !change || typeof change !== "object" || !paths.includes(change.path) || change.target?.kind !== "global"
      || !(change.value === null && (change.path === "reading.fontFamily" || change.path === "appearance.contentTypography.fontFamily")
        || typeof change.value === "boolean" || typeof change.value === "number" && Number.isFinite(change.value)
        || typeof change.value === "string" && change.value.length <= 1024))
    || new Set(profile.changes.map(change => change.path)).size !== paths.length) return null;
  return { version: profile.version, name: profile.name.trim(), changes: paths.map(path => ({
    path, value: profile.changes.find(change => change.path === path)!.value, target: { kind: "global" },
  })) };
}
export async function listProfiles(ctx: PluginContext, cursor?: string, limit = 40) {
  return profileCollection(ctx).page({ limit, ...(cursor ? { cursor } : {}) });
}
export async function captureProfile(ctx: PluginContext, name: string): Promise<Profile> {
  const cleanName = profileName(name);
  // One snapshot captures the coordinated preset, not independently timed reads.
  const snapshot = await ctx.domains.settings.queries.snapshot({ target: { kind: "global" } });
  const changes = PROFILE_PATHS.map(path => {
    const setting = snapshot.settings.find(setting => setting.path === path);
    if (!setting?.writable) throw Object.assign(Error(`Profile setting unavailable: ${path}`), { code: "plugin/unavailable" });
    return { path, value: setting.value, target: { kind: "global" as const } };
  });
  const profile = parseProfile({ version: 2, name: cleanName, changes });
  if (!profile) return invalid("Invalid workspace snapshot");
  return profile;
}
export async function profileToken(profile: Profile) {
  const bytes = new TextEncoder().encode(JSON.stringify(profile.changes));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `wp1:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export async function saveProfile(ctx: PluginContext, name: string, expectedToken?: string) {
  const profile = await captureProfile(ctx, name);
  if (expectedToken !== undefined && await profileToken(profile) !== expectedToken) return { status: "stale-workspace" as const };
  const id = crypto.randomUUID();
  const receipt = await ctx.services.storage.applyDocuments([{ kind: "put", collection: "profiles", id, data: profile, expectedRevision: null }]);
  return receipt.status === "conflict" ? { status: "conflict" as const } : { status: "saved" as const, id, name: profile.name };
}
export async function readProfile(ctx: PluginContext, id: string) {
  const doc = await profileCollection(ctx).get(id);
  if (!doc) throw Object.assign(Error("Workspace profile no longer exists"), { code: "plugin/unavailable" });
  const profile = parseProfile(doc.data);
  if (!profile) return invalid("Invalid workspace profile");
  return { ...doc, data: profile };
}
export async function applyProfile(ctx: PluginContext, id: string, expectedRevision: string) {
  const doc = await profileCollection(ctx).get(id);
  if (!doc || doc.revision !== expectedRevision) return { status: "conflict" as const };
  const profile = parseProfile(doc.data);
  if (!profile) return invalid("Invalid workspace profile");
  // Current host catalog validates stale/uninstalled theme references atomically.
  const receipt = await ctx.domains.settings.commands.update(profile.changes);
  return { status: "applied" as const, id, name: profile.name, changed: receipt.changed, overrides: receipt.settings.overrides };
}
export async function deleteProfile(ctx: PluginContext, id: string, expectedRevision: string) {
  const receipt = await ctx.services.storage.applyDocuments([{ kind: "delete", collection: "profiles", id, expectedRevision }]);
  return { status: receipt.status === "conflict" ? "conflict" as const : "deleted" as const, id };
}
