import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { X } from "@phosphor-icons/react";
import { Caption, IconButton } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { useZoomPan } from "../hooks/useZoomPan";

type ReaderImageLightboxProps = {
  src: string;
  alt: string | null;
  onClose: () => void;
};

/**
 * Full-screen viewer for a book illustration (issue #13). Wheel / trackpad
 * pinch / touch pinch zoom around the cursor, dragging pans when zoomed,
 * double-click toggles fit ↔ zoomed, Esc / ✕ / a clean backdrop click close.
 */
export function ReaderImageLightbox({ src, alt, onClose }: ReaderImageLightboxProps) {
  const { t } = useTranslation("reader");
  const zoom = useZoomPan();

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? t("imageViewer.label")}
      className="fixed inset-0 z-50 flex flex-col bg-stone-950/90"
    >
      <div
        ref={zoom.stageRef}
        className="relative flex min-h-0 flex-1 cursor-zoom-in items-center justify-center overflow-hidden touch-none"
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
          src={displaySrc}
          alt={alt ?? ""}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={zoom.style}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-4">
        <IconButton
          size="sm"
          label={t("imageViewer.close")}
          onClick={onClose}
          className="pointer-events-auto text-stone-300 hover:text-stone-100"
          icon={<X size={20} aria-hidden="true" />}
        />
      </div>
      {alt && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
          <Caption className="max-w-xl truncate text-stone-400">{alt}</Caption>
        </div>
      )}
    </div>
  );
}
