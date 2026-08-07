import { useTranslation } from "../../../i18n";

/**
 * Live sample of the content typography — a two-turn exchange, because that
 * is the shape these settings mostly govern. It reads the same custom
 * properties the real surfaces do (via `ra-content-type`), so it is the
 * setting rather than a drawing of it: no style is passed in, and there is
 * nothing to keep in sync.
 */
export function ContentTypographyPreview() {
  const { t } = useTranslation("settings");
  return (
    <div
      className="overflow-hidden rounded-md border border-border bg-surface"
      aria-label={t("appearance.contentType.previewLabel")}
    >
      <div className="flex flex-col gap-2 px-5 py-4">
        <div className="flex justify-end">
          <div className="ra-content-type max-w-[85%] rounded-lg bg-fill-strong px-3 py-2 text-fg">
            {t("appearance.contentType.previewQuestion")}
          </div>
        </div>
        <p className="ra-content-type m-0 text-fg">
          {t("appearance.contentType.previewAnswer")}
        </p>
      </div>
    </div>
  );
}
