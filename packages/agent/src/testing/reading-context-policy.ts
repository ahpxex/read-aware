import type { ReadingContextPermissions } from "../runtime/reading-context-policy";

export function contextPolicyState(initial: ReadingContextPermissions) {
  let state = { ...initial };
  const listeners = new Set<() => void>();
  return {
    snapshot: () => ({ ...state }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set: (next: ReadingContextPermissions) => {
      state = { ...next };
      for (const listener of [...listeners]) listener();
    },
    listeners: () => listeners.size,
  };
}
