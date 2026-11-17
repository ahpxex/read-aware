import { createPortal } from "react-dom";
import { Button, IconButton, InlineError, Skeleton } from "@read-aware/ui";
import { X } from "@phosphor-icons/react";
import { ReaderImageLightbox } from "../../reader/components/ReaderImageLightbox";
import { useTranslation } from "../../../i18n";
import { loadChatImage } from "../lib/chat-image";
import { useWebImage } from "../hooks/useWebImage";
import type { ChatImageAttachment as Attachment } from "../lib/chat-types";

export function ChatImageAttachment({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  const { t } = useTranslation("ai");
  const preview = useWebImage(attachment.cacheKey, attachment.cacheKey, loadChatImage);
  return (
    <div className="relative w-28">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-mark bg-fill">
        {preview.failed ? (
          <InlineError compact>{t("chat.localImageUnavailable")}</InlineError>
        ) : preview.url ? (
          <Button
            variant="link"
            ref={preview.triggerRef}
            onClick={preview.openViewer}
            aria-label={t("chat.references.openImage", { caption: attachment.name })}
            className="h-full w-full cursor-zoom-in"
          >
            <img
              src={preview.url}
              alt={attachment.name}
              onError={preview.failedImage}
              className="h-full w-full object-contain"
            />
          </Button>
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
      {onRemove && (
        <IconButton
          label={t("chat.removeImage")}
          icon={<X size={12} />}
          size="sm"
          onClick={onRemove}
          className="absolute right-0 top-0 bg-paper"
        />
      )}
      {preview.viewerUrl &&
        createPortal(
          <ReaderImageLightbox src={preview.viewerUrl} alt={attachment.name} onClose={preview.closeViewer} />,
          document.body,
        )}
    </div>
  );
}
