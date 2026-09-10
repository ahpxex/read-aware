import { AppError, type HostSyncFlowRequest } from "@read-aware/core";
import { HostActionFlow } from "./host-action-flow";

export class SyncFlowController extends HostActionFlow<HostSyncFlowRequest, "completed" | "external-opened"> {
  constructor(navigate: (signal?: AbortSignal) => Promise<unknown>, epoch: () => number = () => 0) {
    super({ navigate, epoch,
      normalize: input => {
        if (!input || !["connect", "disconnect", "delete-account", "upgrade", "billing"].includes(input.action)
          || (input.transportRef !== undefined && (input.action !== "connect" || typeof input.transportRef !== "string" || !input.transportRef.length || input.transportRef.length > 256))) {
          throw new AppError("ui/invalid-target", "Invalid sync flow");
        }
        return { action: input.action, ...(input.transportRef !== undefined ? { transportRef: input.transportRef } : {}) };
      },
      completion: action => action === "upgrade" || action === "billing" ? "external-opened" : "completed",
    });
  }
}
