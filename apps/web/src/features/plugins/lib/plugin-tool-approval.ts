import { AppError } from "@read-aware/core";
import { intersects } from "semver";

export function assertToolApproval(value: unknown, range?: string): void {
  if (value === undefined) return;
  if (value !== "required" || !range || intersects(range, ">=0.0.0 <1.2.0")) {
    throw new AppError("plugin/invalid-input", "Tool approval requires agentTools >=1.2 and approval=required");
  }
}
