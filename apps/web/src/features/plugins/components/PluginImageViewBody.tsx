import { Caption, InlineError, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { describeError } from "../../../i18n/describe-error";
import type { PluginImageView } from "../lib/plugin-types";
import { usePluginImage } from "../hooks/usePluginImage";

export function PluginImageViewBody({ view }: { view: PluginImageView }) {
  const { t } = useTranslation(["plugins", "common"]);
  const image = usePluginImage(view);
  const failure = image.error ? describeError(image.error, { fallback: t("viewer.imageFailed") }) : null;
  return <figure className="m-0 min-w-0 max-w-full" aria-label={view.title}>
    <div className="relative w-full min-w-0 overflow-hidden" style={{ aspectRatio: view.aspectRatio ?? 4 / 3 }}
      aria-busy={!failure && !image.loaded}>
      {image.url && !failure && <img src={image.url} alt={view.alt} draggable={false}
        className="absolute inset-0 size-full object-contain" style={{ opacity: image.loaded ? 1 : 0 }}
        onLoad={image.loadedImage} onError={image.failedImage} />}
      {!failure && !image.loaded && <div className="absolute inset-0 grid place-items-center"><Spinner size="sm" label={t("viewer.loading")} /></div>}
      {failure && <div className="absolute inset-0 overflow-auto p-2"><InlineError
        onRetry={failure.retryable ? image.retry : undefined} retryLabel={t("common:errorBoundary.retry")}>
        {failure.body}
      </InlineError></div>}
    </div>
    {view.caption && <Caption as="figcaption" className="mt-2 break-words whitespace-pre-wrap text-fg-muted">{view.caption}</Caption>}
  </figure>;
}
