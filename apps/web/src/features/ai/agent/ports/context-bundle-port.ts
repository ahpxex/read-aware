/** ContextBundlePort: the Agent acts with every domain grant; scope and fence stay host-resolved. */
import { FULL_DOMAIN_GRANTS, type ContextBundlePort } from "@read-aware/core";
import { contextBundleAccess } from "../../../../domain/context-bundle-access";
import { agentResources } from "../../../../services/resources";

export function createContextBundlePort(): ContextBundlePort {
  const access = contextBundleAccess({ origin: "agent", grants: FULL_DOMAIN_GRANTS });
  return {
    capture: access.capture,
    history: access.history,
    read: access.read,
    export: (threadKey, query, signal) => access.export(query, agentResources(threadKey, query.scope.kind === "book" ? query.scope.id : undefined), signal),
  };
}
