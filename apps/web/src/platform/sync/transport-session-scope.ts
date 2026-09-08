import type { PluginSyncTransportSession } from "@read-aware/plugin-types";
import { createLogger } from "../logger";

const log = createLogger("sync-session");

/** Temporary connection rituals close before publishing a durable binding. */
export async function withTransportSession<T>(session: PluginSyncTransportSession, run: () => Promise<T>): Promise<T> {
  let failed = false;
  try { return await run(); }
  catch (error) { failed = true; throw error; }
  finally {
    try { await session.close(); }
    catch (error) {
      if (!failed) throw error;
      // Preserve the actionable operation error, e.g. the wrong passphrase.
      log.warn("Transport cleanup also failed after connection failure", error);
    }
  }
}
