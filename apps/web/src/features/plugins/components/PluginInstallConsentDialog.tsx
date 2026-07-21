/**
 * The install-time disclosure gate (docs/plugin-system.md §2 — installation
 * is the trust boundary): who the plugin is, the trust warning, and every
 * declared permission spelled out, before any file lands or code runs.
 */
import { useAtomValue } from "jotai";
import { Badge, Button, Caption, Dialog } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { pluginInstallConsentAtom } from "../state/plugin-store";

export function PluginInstallConsentDialog() {
  const { t } = useTranslation("plugins");
  const request = useAtomValue(pluginInstallConsentAtom);
  const manifest = request?.manifest;
  const permissions = manifest?.permissions ?? [];

  return (
    <Dialog
      open={request !== null}
      onClose={() => request?.resolve(false)}
      title={manifest ? t("settings.installConfirm.title", { name: manifest.name }) : ""}
      className="w-full max-w-sm"
    >
      {manifest && (
        <div className="flex flex-col gap-3">
          <Caption className="text-fg-subtle">
            v{manifest.version}
            {manifest.author ? ` · ${manifest.author}` : ""}
          </Caption>
          {manifest.description && (
            <p className="font-sans text-sm text-fg-muted">{manifest.description}</p>
          )}

          <p className="border-l-2 border-border pl-3 font-sans text-xs leading-5 text-fg-muted">
            {t("settings.trustWarning")}
          </p>

          <div className="flex flex-col gap-1.5">
            {permissions.length === 0 ? (
              <Caption className="text-fg-subtle">{t("settings.noPermissions")}</Caption>
            ) : (
              permissions.map((permission) => (
                <div key={permission} className="flex items-baseline gap-2">
                  <Badge className="shrink-0 text-[11px]">{permission}</Badge>
                  <span className="font-sans text-xs leading-5 text-fg-muted">
                    {t(`settings.permission.${permission}`)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={() => request.resolve(false)}>
              {t("settings.installConfirm.cancel")}
            </Button>
            <Button size="sm" onClick={() => request.resolve(true)}>
              {t("settings.installConfirm.confirm")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
