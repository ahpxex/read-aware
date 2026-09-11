import { validateContextBundle, type ResourceRef } from "@read-aware/core";
import type { ContextResourceAccess } from "../services/resource-access";
import type { ResourceOwner } from "../services/resource-owner";

/** Internal transport only. The host must prove disclosure authority for this exact artifact. */
export function exportContextBundle(owner: ResourceOwner, input: unknown, access: ContextResourceAccess, signal?: AbortSignal): Promise<ResourceRef> {
  // Start validation synchronously to copy content before the actor queue can yield.
  const validated = validateContextBundle(input);
  // A rejected queue may never call load; its validation failure is still observed.
  void validated.catch(() => { /* The load callback propagates validation failures when dispatched. */ });
  return owner.importContext(async () => {
    const bundle = await validated;
    return { name: `${bundle.content.kind}-${bundle.version.slice(4)}.json`,
      bytes: new TextEncoder().encode(`${JSON.stringify(bundle)}\n`) };
  }, access, signal);
}
