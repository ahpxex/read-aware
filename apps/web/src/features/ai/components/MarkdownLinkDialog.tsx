import { Check, Copy, X } from "@phosphor-icons/react";
import { Button, Dialog, IconButton, buttonClassName } from "@read-aware/ui";
import { useExternalLink } from "../../../hooks/useExternalLink";
import { useTranslation } from "../../../i18n";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";

/** Confirms leaving the app for a link in a reply; opening goes through the native opener. */
export function MarkdownLinkDialog({ isOpen, onClose, url }: { isOpen: boolean; onClose: () => void; url: string }) {
  const { t } = useTranslation("ai");
  const openLink = useExternalLink(onClose);
  const { copied, copy } = useCopyToClipboard();

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={t("chat.externalLink.title")}
      backdrop="dim"
      className="max-w-md p-6"
    >
      <IconButton
        icon={<X size={16} />}
        label={t("chat.externalLink.close")}
        size="sm"
        onClick={onClose}
        className="absolute right-3 top-3"
      />
      <div className="mt-3 space-y-4">
        <p>{t("chat.externalLink.description")}</p>
        <div
          dir="ltr"
          className="max-h-32 select-text overflow-y-auto break-all rounded-control bg-fill px-3 py-2 font-mono text-xs text-fg-muted"
        >
          {url}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={() => void copy(url)}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {t(copied ? "chat.message.copied" : "chat.externalLink.copy")}
          </Button>
          {/* window.open is swallowed by Tauri; useExternalLink hands the URL to the system opener. */}
          <a href={url} target="_blank" rel="noreferrer" onClick={openLink} className={buttonClassName()}>
            {t("chat.externalLink.open")}
          </a>
        </div>
      </div>
    </Dialog>
  );
}
