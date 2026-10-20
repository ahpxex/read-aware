import { Trans } from "react-i18next";
import { Button, Dialog, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { UserFontEntry } from "../../../domain/fonts";

type UserFontRemoveDialogProps = {
  font: UserFontEntry | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/**
 * Remove-an-imported-font confirmation — BookRemoveDialog's twin. Removal is
 * a synced fact (`userFont.removed`), so the copy names the consequence:
 * the font leaves every signed-in device and books using it fall back.
 */
export function UserFontRemoveDialog({ font, busy, onClose, onConfirm }: UserFontRemoveDialogProps) {
  const { t } = useTranslation("settings");
  return (
    <Dialog open={font !== null} onClose={onClose} title={t("font.removeTitle")}>
      <div className="space-y-4">
        <p>
          <Trans
            ns="settings"
            i18nKey="font.removeBody"
            values={{ name: font?.name ?? "" }}
            components={{ strong: <strong /> }}
          />
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {t("font.cancel")}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner size="sm" className="mr-1.5" /> : null}
            {t("font.removeConfirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
