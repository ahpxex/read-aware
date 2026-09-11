import type { RuntimeDeps } from "@read-aware/agent";
import { decideEntity, queryEntities } from "../../../../domain/entity-registry";

export function createEntityRegistryPort(): RuntimeDeps["entityRegistry"] {
  return { query: queryEntities, decide: (input, signal) => decideEntity(input, "agent", signal) };
}
