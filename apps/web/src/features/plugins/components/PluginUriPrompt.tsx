import { Button, Dialog } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { usePluginUriPrompt } from "../hooks/usePluginUriPrompt";

export function PluginUriPrompt() {
  const { t } = useTranslation("plugins");
  const { prompt, visible, enabled, close, open } = usePluginUriPrompt();
  return (
    <Dialog
      open={visible}
      onClose={close}
      title={t("uri.title", { name: prompt?.handler?.pluginName ?? prompt?.link.pluginId ?? "" })}
      className="w-full max-w-md"
    >
      {prompt && (
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-sm text-fg-muted">{t(enabled ? "uri.description" : "uri.unavailable")}</p>
          <div
            className="max-h-40 overflow-auto break-all rounded-control border border-border p-2 font-mono text-xs"
            dir="ltr"
          >
            {prompt.link.url}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={close}>
              {t("uri.cancel")}
            </Button>
            <Button size="sm" disabled={!enabled} onClick={open}>
              {t("uri.open")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
