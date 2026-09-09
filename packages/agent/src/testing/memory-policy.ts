import type { MemoryBuildPolicy } from "../memory/build-policy";

export function memoryPolicyState() {
  let enabled = true;
  const listeners = new Set<() => void>();
  const policy: MemoryBuildPolicy = {
    enabled: () => enabled,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { policy, count: () => listeners.size, set(value: boolean) { enabled = value; for (const listener of [...listeners]) listener(); } };
}
