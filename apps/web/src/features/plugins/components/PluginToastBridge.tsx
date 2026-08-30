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

export function PluginToastBridge() {
  const { toast } = useToast();
  const { t } = useTranslation("plugins");
  useEffect(() => {
    setPluginToastHandler((payload) => {
      if (payload.kind === "failure") {
        toast({
          variant: "destructive",
          title: payload.pluginName,
          description: t("runtime.actionFailed"),
        });
        return;
      }
      toast({ description: payload.message });
    });
    return () => setPluginToastHandler(null);
  }, [toast, t]);
  return null;
}
