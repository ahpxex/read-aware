/**
 * Mounted once inside the ToastProvider tree; hands the live toast dispatcher
 * to the module-level bridge so non-React plugin code can show notices.
 * Failure payloads render destructive with localized copy — success and
 * failure must never look alike.
 */
import { useEffect } from "react";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { setPluginToastHandler } from "../lib/plugin-toast";
import { describeErrorCode } from "../../../i18n/describe-error";

export function PluginToastBridge() {
  const { toast } = useToast();
  const { t } = useTranslation(["plugins", "common"]);
  useEffect(() => {
    setPluginToastHandler((payload) => {
      if (payload.kind === "failure") {
        const description = describeErrorCode(payload.code);
        const handle = toast({
          variant: "destructive",
          title: payload.pluginName,
          description: description?.body ?? t("runtime.actionFailed"),
          action: description?.retryable && payload.retry ? { label: t("common:errorBoundary.retry"), onClick: payload.retry } : undefined,
          onDismiss: payload.onDismiss,
        });
        return handle.dismiss;
      }
      toast({ description: payload.message });
    });
    return () => setPluginToastHandler(null);
  }, [toast, t]);
  return null;
}
