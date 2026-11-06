import { AppError, errorCode } from "@read-aware/core";
import { invoke } from "../../../platform/ipc";
import { flushLocalKV, restoreLocalKVTransaction } from "../../../platform/local-store";
import { dispatchMinted, broadcastDomainEventDrafts, type DomainEventDraft } from "../../../platform/domain-events";
import { createLogger } from "../../../platform/logger";
import { PluginPreferencePublication } from "../../../platform/plugin-preference-publication";
import { PLUGIN_SCHEMA_KEY_PREFIX, snapshotPluginData, type PluginDataSnapshot } from "./plugin-data-snapshot";

export type PluginUpdateJournal = {
  updateId: string;
  pluginId: string;
  candidateToken: string | null;
  hadPrevious: boolean | null;
  baseline: PluginDataSnapshot;
  phase: "prepared" | "accepted";
  accepted: PluginDataSnapshot | null;
};
const log = createLogger("plugin-update-journal");

export async function beginPluginUpdate(pluginId: string, candidateToken?: string): Promise<PluginUpdateJournal> {
  await flushLocalKV(`read-aware-plugin.${pluginId}.`);
  await flushLocalKV(PLUGIN_SCHEMA_KEY_PREFIX + pluginId);
  const updateId = crypto.randomUUID();
  try {
    return await invoke("plugins_update_begin", { pluginId, updateId, candidateToken: candidateToken ?? null });
  } catch (error) {
    const decision = await invoke<PluginUpdateJournal | null>("plugins_update_get", { updateId }).catch((readError) => {
      // An unreadable decision cannot authorize restarting a writer whose
      // future data might be overwritten by native recovery.
      PluginPreferencePublication.quarantineOwner(pluginId);
      log.warn("Could not resolve plugin update preparation", readError);
      throw error;
    });
    if (
      decision?.phase === "prepared" &&
      decision.pluginId === pluginId &&
      decision.candidateToken === (candidateToken ?? null)
    )
      return decision;
    throw error;
  }
}

export function pluginPreferenceChanges(before: PluginDataSnapshot, after: PluginDataSnapshot): DomainEventDraft[] {
  const events: DomainEventDraft[] = [];
  for (const key of [...new Set([...Object.keys(before.kv), ...Object.keys(after.kv)])].sort()) {
    if (key === "schedule-state" || key === "schedule-runs" || before.kv[key] === after.kv[key]) continue;
    const raw = Object.prototype.hasOwnProperty.call(after.kv, key) ? after.kv[key]! : null;
    try {
      events.push({
        type: "preference.changed",
        origin: "user",
        payload: { key: `read-aware-plugin.${after.pluginId}.${key}`, value: raw === null ? null : JSON.parse(raw) },
      });
    } catch {
      /* Non-JSON KV has never participated in roaming. */
    }
  }
  return events;
}

/** Accept and publish the final diff in one native transaction. A lost reply
 * is resolved from its durable decision before the host considers rollback. */
export async function acceptPluginUpdate(journal: PluginUpdateJournal): Promise<PluginUpdateJournal> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await snapshotPluginData(journal.pluginId);
    const drafts = pluginPreferenceChanges(journal.baseline, snapshot);
    let result: PluginUpdateJournal;
    try {
      result = await dispatchMinted(drafts, (events) =>
        invoke<PluginUpdateJournal>("plugins_update_accept", {
          updateId: journal.updateId,
          expectedKv: snapshot.kv,
          expectedSchema: snapshot.schema,
          events,
        }),
      );
    } catch (error) {
      const decision = await invoke<PluginUpdateJournal | null>("plugins_update_get", {
        updateId: journal.updateId,
      }).catch((readError) => {
        log.warn("Could not resolve plugin update decision", readError);
        return null;
      });
      if (decision?.phase === "accepted") result = decision;
      else if (errorCode(error) === "plugin/data-busy" && decision?.phase === "prepared" && attempt < 2) continue;
      else throw error;
    }
    if (result.phase !== "accepted" || !result.accepted)
      throw new AppError("plugin/recovery-required", "Missing accepted plugin update receipt");
    broadcastDomainEventDrafts(pluginPreferenceChanges(journal.baseline, result.accepted));
    // A later ordinary write must settle its JS mirror before rebasing the
    // publication scope; failure cannot revoke the native acceptance decision.
    await flushLocalKV(`read-aware-plugin.${journal.pluginId}.`).catch((error) =>
      log.warn("Post-acceptance plugin write failed", error),
    );
    return result;
  }
  throw new AppError("plugin/data-busy", "Plugin data kept changing during acceptance");
}

export async function rollbackPluginUpdate(journal: PluginUpdateJournal): Promise<void> {
  const baseline = structuredClone(journal.baseline);
  await restoreLocalKVTransaction(
    `read-aware-plugin.${journal.pluginId}.`,
    baseline.kv,
    new Map([[PLUGIN_SCHEMA_KEY_PREFIX + journal.pluginId, baseline.schema]]),
    () => invoke("plugins_update_rollback", { updateId: journal.updateId }),
  );
}

/** Accepted files/data are already durable; orphan cleanup never reverses them. */
export async function finishPluginUpdate(journal: PluginUpdateJournal): Promise<void> {
  await invoke("plugins_update_finish", { updateId: journal.updateId }).catch((error) =>
    log.warn("Accepted plugin backup cleanup will retry at boot", error),
  );
}
