import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowClockwise,
  Check,
  CopySimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  X,
} from "@phosphor-icons/react";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { Caption, IconButton } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { useZoomPan } from "../hooks/useZoomPan";

type ReaderImageLightboxProps = {
  src: string;
  alt: string | null;
  onClose: () => void;
};

/**
 * Full-screen viewer for a book illustration (issue #13). Wheel / trackpad
 * pinch / touch pinch zoom around the cursor, dragging pans when zoomed,
 * double-click toggles fit ↔ zoomed. The bottom toolbar carries zoom steps,
 * rotation, copy-to-clipboard, and close; Esc and a clean backdrop click
 * close too.
 */
export function ReaderImageLightbox({ src, alt, onClose }: ReaderImageLightboxProps) {
  const { t } = useTranslation("reader");
  const zoom = useZoomPan();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // The section's blob URL dies when foliate unloads the page under the open
  // viewer, and remote (plugin/RSS) image hosts are not in the app document's
  // img-src — so copy the bytes into a fresh top-document blob. connect-src
  // covers both blob: and https:. Until (or if ever) the copy lands, the raw
  // src is the fallback.
  const [displaySrc, setDisplaySrc] = useState(src);
  useEffect(() => {
    let objectUrl: string | null = null;
    let disposed = false;
    if (!src.startsWith("data:")) {
      void fetch(src)
        .then((response) => response.blob())
        .then((blob) => {
          if (disposed) return;
          objectUrl = URL.createObjectURL(blob);
          setDisplaySrc(objectUrl);
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  // Take keyboard focus out of the section iframe: keydown fires in whichever
  // realm holds focus, and before this landed an Esc pressed while the book
  // still had it never reached the top window — the viewer felt stuck open.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  // Copy the plate as PNG. Books carry JPEG/SVG/whatever; the clipboard wants
  // PNG, so redraw through a canvas (the displayed blob is same-origin — no
  // taint). In the app the bytes go through the clipboard-manager plugin —
  // WKWebView rejects navigator.clipboard.write for images outright
  // (NotAllowedError, no permission prompt to grant). The web/Storybook branch
  // keeps clipboard.write, called synchronously with a promise-shaped
  // ClipboardItem so the click's user activation still covers it. The
  // check-mark flash is the only feedback a quiet overlay needs.
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);
  const flashCopied = useCallback(() => {
    setCopied(true);
    if (copyResetRef.current != null) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopied(false), 1500);
  }, []);
  const copyImage = useCallback(() => {
    const img = zoom.imgRef.current;
    if (!img?.naturalWidth) return;
    const renderPng = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("PNG encode failed");
      return blob;
    };
    const write = isTauri()
      ? renderPng()
          .then(async (blob) => writeImage(new Uint8Array(await blob.arrayBuffer())))
      : navigator.clipboard.write([
          new ClipboardItem({ "image/png": renderPng() }),
        ]);
    write
      .then(flashCopied)
      .catch((error) => console.warn("[reader] copy image failed", error));
  }, [flashCopied, zoom.imgRef]);
  useEffect(() => () => {
    if (copyResetRef.current != null) window.clearTimeout(copyResetRef.current);
  }, []);

  // The second click of an image double-click lands on the freshly-opened
  // backdrop; ignoring backdrop clicks briefly keeps "double-click to open"
  // from closing what it just opened.
  const openedAtRef = useRef(performance.now());
  const backdropPressRef = useRef(false);
  const onBackdropPointerDown = (event: ReactPointerEvent) => {
    backdropPressRef.current = event.target === event.currentTarget;
  };
  const onBackdropPointerUp = (event: ReactPointerEvent) => {
    const eligible = backdropPressRef.current && event.target === event.currentTarget;
    backdropPressRef.current = false;
    if (!eligible || zoom.movedRef.current) return;
    if (performance.now() - openedAtRef.current < 350) return;
    onClose();
  };

  const toolButtonClass = "text-stone-300 hover:text-stone-100";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? t("imageViewer.label")}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-stone-950/90 outline-none"
      onKeyDown={(event) => {
        if (event.key === "+" || event.key === "=") zoom.zoomIn();
        else if (event.key === "-") zoom.zoomOut();
        else if (event.key === "0") zoom.reset();
      }}
    >
      <div
        ref={zoom.stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden touch-none"
        style={{ cursor: zoom.zoomed ? "grab" : "zoom-in" }}
        onPointerDown={(event) => {
          onBackdropPointerDown(event);
          zoom.handlers.onPointerDown(event);
        }}
        onPointerUp={(event) => {
          zoom.handlers.onPointerUp(event);
          onBackdropPointerUp(event);
        }}
        onPointerMove={zoom.handlers.onPointerMove}
        onPointerCancel={zoom.handlers.onPointerCancel}
        onWheel={zoom.handlers.onWheel}
        onDoubleClick={zoom.handlers.onDoubleClick}
      >
        <img
          ref={zoom.imgRef}
          src={displaySrc}
          alt={alt ?? ""}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={zoom.style}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-5">
        {alt && (
          <Caption className="max-w-xl truncate text-stone-400">{alt}</Caption>
        )}
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg bg-stone-900/95 px-1.5 py-1">
          <IconButton
            size="sm"
            label={t("imageViewer.zoomOut")}
            onClick={zoom.zoomOut}
            className={toolButtonClass}
            icon={<MagnifyingGlassMinus size={18} aria-hidden="true" />}
          />
          <IconButton
            size="sm"
            label={t("imageViewer.zoomIn")}
            onClick={zoom.zoomIn}
            className={toolButtonClass}
            icon={<MagnifyingGlassPlus size={18} aria-hidden="true" />}
          />
          <IconButton
            size="sm"
            label={t("imageViewer.rotate")}
            onClick={zoom.rotateRight}
            className={toolButtonClass}
            icon={<ArrowClockwise size={18} aria-hidden="true" />}
          />
          <IconButton
            size="sm"
            label={copied ? t("imageViewer.copied") : t("imageViewer.copy")}
            onClick={copyImage}
            className={toolButtonClass}
            icon={
              copied ? (
                <Check size={18} aria-hidden="true" />
              ) : (
                <CopySimple size={18} aria-hidden="true" />
              )
            }
          />
          <div aria-hidden="true" className="mx-1 h-4 w-px bg-stone-700" />
          <IconButton
            size="sm"
            label={t("imageViewer.close")}
            onClick={onClose}
            className={toolButtonClass}
            icon={<X size={18} aria-hidden="true" />}
          />
        </div>
      </div>
    </div>
  );
}
