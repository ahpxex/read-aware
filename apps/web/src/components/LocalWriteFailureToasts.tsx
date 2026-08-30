/**
 * Mounted once inside the ToastProvider tree. The platform KV / secret stores
 * are write-through snapshots: a failed durable write rolls the snapshot back
 * and emits `local-write-failed` (see platform/local-store, secret-store).
 * This bridge turns that into a destructive toast, so a change that will not
 * survive a restart is never silently presented as saved. The raw cause is
 * already in the file log at the failure site.
 */
import { useEffect } from "react";
import { useToast } from "@read-aware/ui";
import { describeErrorCode, useTranslation } from "../i18n";
import { onAppEvent } from "../platform/app-events";

export function LocalWriteFailureToasts() {
  const { toast } = useToast();
  const { t } = useTranslation("common");
  useEffect(
    () =>
      onAppEvent("local-write-failed", ({ code }) => {
        toast({
          variant: "destructive",
          title: t("errors.localSaveFailedTitle"),
          description: describeErrorCode(code)?.body ?? t("errors.localSaveFailed"),
        });
      }),
    [toast, t],
  );
  return null;
}
