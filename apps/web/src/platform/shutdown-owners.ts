import { hostShutdown } from "../services/shutdown";
import { flushLocalKV, hasPendingLocalKVWrites } from "./local-store";
import { durableWrites } from "./write-settlement";
import { readingTraces } from "../features/reader/lib/reading-trace-runtime";
import { shutdownPlugins } from "../features/plugins/runtime/plugin-host";

/** The product's durable owners, in the order a close must respect: end the reading session
 * and quiesce plugins (they still enqueue writes), wait for dispatched events, then drain KV. */
export function registerShutdownOwners(): () => void {
  const disposers = [
    hostShutdown.register("reading-traces", "settle", () => readingTraces.settle()),
    hostShutdown.register("plugins", "settle", signal => shutdownPlugins(signal)),
    hostShutdown.register("domain-events", "persist", signal => durableWrites.settle(signal)),
    hostShutdown.register("local-kv", "persist", async () => { if (hasPendingLocalKVWrites()) await flushLocalKV(); }),
  ];
  return () => { for (const dispose of disposers) dispose(); };
}
