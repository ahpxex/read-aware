import { AppError, errorCode } from "@read-aware/core";

function named(error: unknown, name: string): boolean {
  return error !== null && typeof error === "object" && "name" in error && error.name === name;
}

export function pluginNetworkAbort(error: unknown): unknown {
  if (errorCode(error)) return error;
  return named(error, "TimeoutError")
    ? new AppError("plugin/network-timeout", "Plugin network request timed out", { cause: error })
    : new AppError("plugin/cancelled", error instanceof Error ? error.message : "Plugin network request cancelled", { cause: error });
}

/** Transport rejections may be bare native strings; never classify their prose. */
export function pluginNetworkError(error: unknown): unknown {
  if (errorCode(error)) return error;
  if (named(error, "TimeoutError") || named(error, "AbortError")) return pluginNetworkAbort(error);
  return new AppError("plugin/network-failed", "Plugin network request failed", { cause: error, retryable: true });
}
