/**
 * Mounted once inside the ToastProvider tree; hands the live toast dispatcher
 * to the module-level bridge so non-React plugin code can show notices.
 */
import { useEffect } from "react";
import { useToast } from "@read-aware/ui";
import { setPluginToastHandler } from "../lib/plugin-toast";

export function PluginToastBridge() {
  const { toast } = useToast();
  useEffect(() => {
    setPluginToastHandler((message) => toast({ description: message }));
    return () => setPluginToastHandler(null);
  }, [toast]);
  return null;
}
