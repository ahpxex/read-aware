import { Button, Caption, InlineError, Skeleton } from "@read-aware/ui";
import { createPortal } from "react-dom";
import { ReaderImageLightbox } from "../../../reader/components/ReaderImageLightbox";
import { useTranslation } from "../../../../i18n";
import { useExternalLink } from "../../../../hooks/useExternalLink";
import { useWebImage } from "../../hooks/useWebImage";
import type { ChatWebImageReference } from "../../lib/chat-types";

/** One source-backed illustration in the existing persisted reference timeline. */
export function WebImageCard({ image }: { image: ChatWebImageReference }) {
  const { t } = useTranslation("ai");
  const openExternalLink = useExternalLink();
  const preview = useWebImage(image.url, image.thumbnailUrl);
  return (
    <figure className="m-0 flex w-60 max-w-full flex-col gap-1.5" data-testid="chat-web-image">
      <div className="flex aspect-[4/3] w-full shrink-0 items-center justify-center overflow-hidden rounded-mark bg-fill/40">
        {preview.failed ? (
          <InlineError compact>{t("chat.references.imageUnavailable")}</InlineError>
        ) : preview.url ? (
          <Button
            variant="link"
            ref={preview.triggerRef}
            onClick={preview.openViewer}
            className="h-full w-full cursor-zoom-in"
            aria-label={t("chat.references.openImage", { caption: image.caption })}
          >
            <img
              src={preview.url}
              alt={image.caption}
              onError={preview.failedImage}
              className="h-full w-full object-contain"
            />
          </Button>
        ) : (
          <Skeleton className="h-full w-full" aria-label={t("chat.references.imageLoading")} />
        )}
      </div>
      <figcaption className="flex flex-1 flex-col gap-0.5">
        <Caption className="flex-1">{image.caption}</Caption>
        <a
          href={image.sourceUrl}
          onClick={openExternalLink}
          target="_blank"
          rel="noreferrer"
          className="text-caption text-fg-muted underline underline-offset-4"
        >
          {t("chat.references.imageSource", { source: image.title })}
        </a>
      </figcaption>
      {preview.viewerUrl &&
        createPortal(
          <ReaderImageLightbox src={preview.viewerUrl} alt={image.caption} onClose={preview.closeViewer} />,
          document.body,
        )}
    </figure>
  );
}
