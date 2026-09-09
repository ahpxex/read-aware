import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppError, type HostCommandReceipt, type HostCommandRequest } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { workspace } from "../../../services/workspace";
import type { CommandItem } from "../lib/build-commands";

export type NativeCommandExecutor = (request: HostCommandRequest, signal: AbortSignal) => Promise<HostCommandReceipt>;
const executeNative: NativeCommandExecutor = async (request, signal) => {
  const guarded = { ...request, expectedWorkspaceRevision: workspace.snapshot({ limit: 1 }).revision };
  const { trustedHostCommands } = await import("../../../services/host-command-runtime");
  signal.throwIfAborted();
  return trustedHostCommands("user").execute(guarded, signal);
};
const log = createLogger("command-palette");

export function useCommandExecution(isOpen: boolean, onClose: () => void, execute: NativeCommandExecutor = executeNative) {
  const { toast } = useToast(), { t } = useTranslation("command");
  const frame = useRef(0), active = useRef<{ controller: AbortController; frame: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => { frame.current++; setBusy(false); }, [isOpen]);
  useEffect(() => () => { frame.current++; active.current?.controller.abort(new AppError("ui/superseded", "Command owner unmounted")); }, []);
  const dismiss = useCallback(() => {
    frame.current++;
    active.current?.controller.abort(new AppError("ui/superseded", "Command dismissed"));
    setBusy(false); onClose();
  }, [onClose]);
  const run = useCallback(async (item: CommandItem) => {
    if (item.disabled || active.current?.frame === frame.current) return;
    const owner = { controller: new AbortController(), frame: frame.current };
    active.current?.controller.abort(new AppError("ui/superseded", "New command palette invocation"));
    active.current = owner; setBusy(true);
    try {
      if (item.hostCommand) {
        const receipt = await execute(item.hostCommand, owner.controller.signal);
        if (receipt.status === "partial") {
          const failure = new AppError(receipt.errorCode ?? "ui/unavailable", "Host command partially completed");
          log.warn("Host command partially completed", failure);
          if (!owner.controller.signal.aborted) toast({ variant: "destructive", title: t("partial"), description: describeError(failure).body });
          return;
        }
      } else item.perform();
      // Workspace navigation may already have closed this frame. A late result
      // must never close a newer palette, nor cancel its own destination commit.
      if (owner.frame === frame.current && !owner.controller.signal.aborted) onClose();
    } catch (error) {
      log.warn("Command failed", error);
      if (!owner.controller.signal.aborted) toast({ variant: "destructive", description: describeError(error).body });
    } finally {
      if (active.current === owner) { active.current = null; if (owner.frame === frame.current) setBusy(false); }
    }
  }, [execute, onClose, t, toast]);
  return { run, dismiss, busy };
}
