import { AppError } from "@read-aware/core";
import { invoke } from "../../../platform/ipc";
import { flushLocalKV } from "../../../platform/local-store";
import type { PluginLifecycleController } from "./plugin-lifecycle";

export function pluginDurableKV(lifecycle: PluginLifecycleController, prefix: string,
  host = { invoke, flush: flushLocalKV }) {
  return <T = unknown>(key: string): Promise<T | null> => {
    if (typeof key !== "string" || key.length > 1024 || key.includes("\0")) throw new AppError("plugin/invalid-input", "Invalid private storage key");
    return lifecycle.read("services.storage.getDurable", async signal => {
      await lifecycle.drainStorageWrites();
      signal.throwIfAborted();
      await host.flush(prefix);
      signal.throwIfAborted();
      const raw = await host.invoke<string | null>("get_kv", { key: prefix + key });
      signal.throwIfAborted();
      if (raw === null) return null;
      try { return JSON.parse(raw) as T; }
      catch (cause) { throw new AppError("db/error", "Invalid durable plugin KV JSON", { cause }); }
    });
  };
}
