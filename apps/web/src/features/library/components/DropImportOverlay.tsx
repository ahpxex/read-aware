import { Body } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";

/**
 * Full-window hint shown while book files hover over the app.
 * pointer-events-none keeps the drag events flowing to the window listeners
 * in useDropBookImport — the overlay only announces, it never intercepts.
 */
export function DropImportOverlay() {
  const { t } = useTranslation("shelf");
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-paper/80">
      <div className="rounded-lg border-2 border-dashed border-stone-400 bg-paper px-10 py-8">
        <Body className="text-stone-600">{t("dropImport.hint")}</Body>
      </div>
    </div>
  );
}
