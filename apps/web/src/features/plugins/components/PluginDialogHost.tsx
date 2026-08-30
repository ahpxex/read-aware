/**
 * The one modal container for plugin views opened by selection actions and
 * palette commands. The dialog title names the owning plugin (provenance stays
 * visible); the view's own title renders inside. Compact and height-capped,
 * matching the app's dialog conventions.
 *
 * A failed contribution renders an in-place error state (localized from the
 * failure's stable code, with retry — and a settings link when the fix lives
 * there, e.g. AI not configured) instead of closing into a corner toast.
 */
import { useAtom, useSetAtom } from "jotai";
import { Button, Dialog, InlineError } from "@read-aware/ui";
import { describeErrorCode, useTranslation } from "../../../i18n";
import { settingsOpenAtom, settingsSectionRequestAtom } from "../../../state/ui";
import { pluginDialogAtom } from "../state/plugin-store";
import { PluginViewRenderer } from "./PluginViewRenderer";

export function PluginDialogHost() {
  const [request, setRequest] = useAtom(pluginDialogAtom);
  const { t } = useTranslation(["plugins", "common"]);
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const setSettingsSection = useSetAtom(settingsSectionRequestAtom);
  const close = () => setRequest(null);
  const described = request?.failure ? describeErrorCode(request.failure.code) : null;
  return (
    <Dialog
      open={request !== null}
      onClose={close}
      title={request?.pluginName ?? ""}
      className="w-full max-w-md"
    >
      {request?.failure ? (
        <InlineError
          onRetry={request.failure.retry}
          retryLabel={t("common:errorBoundary.retry")}
          action={
            described?.action === "open-ai-settings" ? (
              <Button
                variant="link"
                onClick={() => {
                  close();
                  setSettingsSection("ai");
                  setSettingsOpen(true);
                }}
                className="h-auto p-0 align-baseline text-xs underline underline-offset-2"
              >
                {t("common:actions.openSettings")}
              </Button>
            ) : undefined
          }
        >
          {described?.body ?? t("plugins:runtime.actionFailed")}
        </InlineError>
      ) : (
        request && (
          <PluginViewRenderer
            view={request.view}
            onClose={close}
            dialogFooter
            viewStateKey={request.pluginId}
            className="max-h-[min(24rem,60vh)]"
          />
        )
      )}
    </Dialog>
  );
}
