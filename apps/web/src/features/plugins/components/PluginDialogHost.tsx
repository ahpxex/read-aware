/**
 * The one modal container for plugin views opened by selection actions and
 * palette commands. The dialog title names the owning plugin (provenance stays
 * visible); the view's own title renders inside. Compact and height-capped,
 * matching the app's dialog conventions.
 */
import { useAtom } from "jotai";
import { Dialog } from "@read-aware/ui";
import { pluginDialogAtom } from "../state/plugin-store";
import { PluginViewRenderer } from "./PluginViewRenderer";

export function PluginDialogHost() {
  const [request, setRequest] = useAtom(pluginDialogAtom);
  const close = () => setRequest(null);
  return (
    <Dialog
      open={request !== null}
      onClose={close}
      title={request?.pluginName ?? ""}
      className="w-full max-w-md"
    >
      {request && (
        <PluginViewRenderer
          view={request.view}
          onClose={close}
          className="max-h-[min(24rem,60vh)]"
        />
      )}
    </Dialog>
  );
}
