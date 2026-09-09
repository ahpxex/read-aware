import { AppError } from "@read-aware/core";
import type { PluginViewChannel, PluginViewUpdate, PluginViewUpdateReceipt } from "./plugin-types";

type Channel = { owner: AbortSignal; revision: number; apply: (update: PluginViewUpdate) => void; dispose: () => void };
const channels = new Map<string, Channel>();
const counts = new WeakMap<AbortSignal, number>();

/** Channels grant presentation only, and belong to one activation and one visible frame. */
export function openPluginViewChannel(owner: AbortSignal, apply: Channel["apply"]) {
  if (owner.aborted) throw new AppError("plugin/unavailable", "View owner has retired");
  if ((counts.get(owner) ?? 0) >= 16) throw new AppError("plugin/busy", "Too many visible live views");
  const id = crypto.randomUUID();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; channels.delete(id); counts.set(owner, (counts.get(owner) ?? 1) - 1);
    owner.removeEventListener("abort", dispose);
  };
  counts.set(owner, (counts.get(owner) ?? 0) + 1);
  channels.set(id, { owner, revision: -1, apply, dispose });
  owner.addEventListener("abort", dispose, { once: true });
  return { channel: { id } satisfies PluginViewChannel, dispose };
}

export function publishPluginView(owner: AbortSignal, channel: PluginViewChannel, update: PluginViewUpdate): PluginViewUpdateReceipt {
  if (!channel || typeof channel.id !== "string" || channel.id.length > 128) throw new AppError("plugin/invalid-input", "Invalid view channel");
  const target = channels.get(channel.id);
  // Unknown and foreign channels have the same outcome; no cross-actor discovery.
  if (!target || target.owner !== owner || owner.aborted) return { status: "inactive" };
  if (!update || !Number.isSafeInteger(update.revision) || update.revision < 0) throw new AppError("plugin/invalid-input", "Invalid view revision");
  if (update.revision <= target.revision) return { status: "stale" };
  target.apply(update);
  target.revision = update.revision;
  return { status: "applied" };
}
