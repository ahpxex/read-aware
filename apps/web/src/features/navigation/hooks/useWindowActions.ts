import { useCallback } from "react";
import type { HostWindowRequest } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { describeError } from "../../../i18n/describe-error";
import { createLogger } from "../../../platform/logger";
import { hostWindow } from "../../../services/window";

const log = createLogger("window");
export function useWindowActions() {
  const { toast } = useToast();
  return useCallback((request: HostWindowRequest) => {
    void hostWindow.control(request).catch(error => {
      log.warn("Window action failed", error);
      toast({ variant: "destructive", description: describeError(error).body });
    });
  }, [toast]);
}
