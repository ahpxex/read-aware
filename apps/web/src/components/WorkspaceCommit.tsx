import { useLayoutEffect } from "react";
import { workspace } from "../services/workspace";

/** A suspended or failed destination must not acknowledge an applied intent. */
export function WorkspaceCommit({ surface, token }: { surface: string; token: number }) {
  useLayoutEffect(() => { workspace.acknowledge(surface, token); }, [surface, token]);
  return null;
}
