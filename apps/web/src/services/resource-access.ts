import { AppError } from "@read-aware/core";

/** Host-owned disclosure authority, never supplied by an actor or inferred from a hash. */
export type ResourceAccess = {
  signal: AbortSignal;
  isAllowed(): boolean;
  dispose(): void;
};

export function retainResourceAccess(input: ResourceAccess, report: (error: unknown) => void) {
  const signal = input.signal, isAllowed = input.isAllowed.bind(input), release = input.dispose.bind(input);
  let disposed = false;
  return {
    signal,
    check() {
      signal.throwIfAborted();
      if (disposed || isAllowed() !== true) throw new AppError("memory/forbidden", "Resource disclosure is no longer authorized");
      signal.throwIfAborted();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { release(); } catch (error) { report(error); }
    },
  };
}
