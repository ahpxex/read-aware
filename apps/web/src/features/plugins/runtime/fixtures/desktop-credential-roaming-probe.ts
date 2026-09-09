import { appDataDir } from "@tauri-apps/api/path";
import { errorCode } from "@read-aware/core";
import { onDomainEventBroadcast } from "../../../../platform/domain-events";
import { afterSecretWrites, deleteSecretAsync, getSecret, setSecretAsync } from "../../../../platform/secret-store";
import { openSecret, toBase64 } from "../../../../platform/sync-envelope";
import { getSyncProfile } from "../../../../platform/sync/sync-store";
import { refreshRoamingPreferences } from "../../../../platform/roaming-preferences";
import { onAppEvent } from "../../../../platform/app-events";

const slot = "ai-api-key.capability-roaming-proof";
const key = new Uint8Array(32).fill(13);
const values: (string | null)[] = [];
let changed = 0;
let stop: (() => void) | undefined;
let stopChanges: (() => void) | undefined;
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  if ((await getSyncProfile()).syncEnabled) throw Error("Probe requires disabled sync");
  return path;
}
export async function prepareCredentialRoamingProbe() {
  const path = await isolated();
  if (stop || getSecret("sync.master-key") || getSecret(slot)) throw Error("Probe requires empty owned credentials");
  await setSecretAsync("sync.master-key", toBase64(key), "remote");
  stop = onDomainEventBroadcast(event => {
    if (event.type !== "preference.changed" || event.payload.key !== `secret:${slot}`) return;
    const value = event.payload.value as { sealed: string } | null;
    values.push(value === null ? null : openSecret(key, slot, value.sealed));
  });
  stopChanges = onAppEvent("roaming-preferences-changed", event => {
    if (event.keys.includes(`secret:${slot}`)) changed++;
  });
  return { path, ready: true };
}
export async function writeCredentialRoamingProbe(value: "first" | "second" | "remote" | null) {
  await isolated();
  if (!stop) throw Error("Prepare probe first");
  try {
    if (value === null) await deleteSecretAsync(slot);
    else await setSecretAsync(slot, `synthetic-${value}`, value === "remote" ? "remote" : "local");
    return { status: "completed" };
  } catch (error) { return { status: "failed", code: errorCode(error) }; }
}
export async function inspectCredentialRoamingProbe() {
  await isolated(); await afterSecretWrites(() => {});
  return { publications: values.map(value => value === null ? "deleted" : value.replace("synthetic-", "")), changed,
    current: getSecret(slot).replace("synthetic-", "") || "absent" };
}
export async function refreshCredentialRoamingProbe() {
  await isolated(); await refreshRoamingPreferences();
  return inspectCredentialRoamingProbe();
}
export async function cleanupCredentialRoamingProbe() {
  await isolated();
  stop?.(); stop = undefined; stopChanges?.(); stopChanges = undefined;
  await deleteSecretAsync(slot, "remote");
  await deleteSecretAsync("sync.master-key", "remote");
  return { credentialsRemoved: !getSecret(slot) && !getSecret("sync.master-key") };
}
