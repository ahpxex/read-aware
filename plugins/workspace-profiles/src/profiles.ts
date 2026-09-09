import type { PluginContext } from "@read-aware/plugin-types";

export const PROFILE_PATHS = ["shelf.layout", "shelf.group", "shelf.sort", "appearance.theme", "appearance.motion", "reading.fontSize", "reading.lineSpacing"] as const;
type Change = Parameters<PluginContext["domains"]["settings"]["commands"]["update"]>[0][number];
export type Profile = { version: 1; name: string; changes: Change[] };
const collection = (ctx: PluginContext) => ctx.services.storage.collection("profiles");

export function profileName(name: unknown): string {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw Error("Profile name must contain 1-80 characters");
  return name.trim();
}
export async function listProfiles(ctx: PluginContext) {
  return collection(ctx).list<Profile>();
}
export async function saveProfile(ctx: PluginContext, name: string) {
  const cleanName = profileName(name);
  // One snapshot captures the coordinated preset, not seven independently timed reads.
  const snapshot = await ctx.domains.settings.queries.snapshot({ target: { kind: "global" } });
  const changes = PROFILE_PATHS.map(path => {
    const setting = snapshot.settings.find(setting => setting.path === path);
    if (!setting?.writable) throw Error(`Profile setting unavailable: ${path}`);
    return { path, value: setting.value, target: { kind: "global" as const } };
  });
  const id = crypto.randomUUID();
  await collection(ctx).put(id, { version: 1, name: cleanName, changes } satisfies Profile);
  return { id, name: cleanName };
}
export async function readProfile(ctx: PluginContext, id: string) {
  const doc = await collection(ctx).get<Profile>(id);
  if (!doc) throw Error("Workspace profile no longer exists");
  const profile = doc.data;
  if (profile?.version !== 1 || !Array.isArray(profile.changes) || profile.changes.length !== PROFILE_PATHS.length
    || new Set(profile.changes.map(change => change.path)).size !== PROFILE_PATHS.length
    || profile.changes.some(change => !PROFILE_PATHS.some(path => path === change.path) || change.target?.kind !== "global")) {
    throw Error("Invalid workspace profile");
  }
  profileName(profile.name);
  return doc;
}
export async function applyProfile(ctx: PluginContext, id: string) {
  const doc = await readProfile(ctx, id);
  // Current host catalog validates stale/uninstalled theme references atomically.
  const receipt = await ctx.domains.settings.commands.update(doc.data.changes);
  return { id, name: doc.data.name, changed: receipt.changed, overrides: receipt.settings.overrides };
}
export async function deleteProfile(ctx: PluginContext, id: string) {
  await readProfile(ctx, id);
  await collection(ctx).delete(id);
  return { deleted: id };
}
