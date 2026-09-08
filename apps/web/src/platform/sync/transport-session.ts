import { AppError } from "@read-aware/core";
import type { PluginSyncTransportSession } from "@read-aware/plugin-types";

const operations = [
  "probe", "getMeta", "putMetaIfAbsent", "listEventBatches", "getEventBatch",
  "putEventBatch", "putBlob", "getBlob", "putBlobPart", "commitBlob", "getBlobPart",
] as const satisfies readonly (keyof PluginSyncTransportSession)[];

export async function closeTransportSessionValue(value: unknown, release: (value: unknown) => void, timeoutMs = 5_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const close = value && typeof value === "object" ? (value as { close?: unknown }).close : undefined;
    if (typeof close !== "function") return;
    await Promise.race([
      Promise.resolve().then(() => Reflect.apply(close, value, [])),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AppError("plugin/timeout", "Sync transport close timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    release(value);
  }
}

/** A returned provider session has one owner, independent of its registration. */
export function ownTransportSession(
  value: PluginSyncTransportSession,
  release: (value: unknown) => void,
  onClosed: () => void,
  closeTimeoutMs = 5_000,
): PluginSyncTransportSession {
  if (!value || typeof value.endpointId !== "string" || !value.endpointId
    || typeof value.close !== "function" || operations.some(key => typeof value[key] !== "function")) {
    throw new AppError("plugin/invalid-input", "Invalid sync transport session");
  }
  let source: PluginSyncTransportSession | undefined = value;
  let closing: Promise<void> | undefined;
  const cancellation = new AbortController();
  const unavailable = () => new AppError("plugin/unavailable", "Sync transport session is closed");
  const methods = Object.fromEntries(operations.map(key => [key, async (...args: unknown[]) => {
    if (cancellation.signal.aborted || !source) throw unavailable();
    const current = source;
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(unavailable());
      cancellation.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          if (cancellation.signal.aborted) throw unavailable();
          return Reflect.apply(current[key], current, args);
        }), cancelled,
      ]);
      if (cancellation.signal.aborted) throw unavailable();
      return result;
    } finally {
      cancellation.signal.removeEventListener("abort", abort);
    }
  }]));
  return {
    endpointId: value.endpointId,
    ...methods,
    close() {
      if (closing) return closing;
      cancellation.abort();
      const current = source!;
      source = undefined;
      closing = closeTransportSessionValue(current, release, closeTimeoutMs).finally(onClosed);
      return closing;
    },
  } as PluginSyncTransportSession;
}
