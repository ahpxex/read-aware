import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./lib/cn";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
};

const EXIT_DURATION_MS = 240;

export function Dialog({
  open,
  onClose,
  title,
  "aria-label": ariaLabel,
  children,
  className,
}: DialogProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const panelRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const enterRafRef = useRef<number | null>(null);
  const [isPresent, setIsPresent] = useState(open);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (enterRafRef.current != null) {
      window.cancelAnimationFrame(enterRafRef.current);
      enterRafRef.current = null;
    }

    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (open) {
      setIsPresent(true);
      enterRafRef.current = window.requestAnimationFrame(() => {
        setIsVisible(true);
        enterRafRef.current = null;
      });
      return;
    }

    setIsVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      setIsPresent(false);
      closeTimerRef.current = null;
    }, EXIT_DURATION_MS);
  }, [open]);

  useEffect(() => {
    return () => {
      if (enterRafRef.current != null) {
        window.cancelAnimationFrame(enterRafRef.current);
      }
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isPresent) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPresent, onClose]);

  useEffect(() => {
    if (!isPresent) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isPresent]);

  useEffect(() => {
    if (!isVisible) return;
    panelRef.current?.focus();
  }, [isVisible]);

  if (!isPresent) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-6 sm:p-8">
      <button
        type="button"
        aria-hidden="true"
        onMouseDown={onClose}
        className={cn(
          "absolute inset-0 bg-stone-950/20 backdrop-blur-sm transition-opacity duration-220 ease-[var(--ra-ease-out-quart)] motion-reduce:transition-none",
          isVisible ? "opacity-100" : "opacity-0",
        )}
      />
      <section
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        className={cn(
          "relative w-full max-w-lg border border-border bg-paper p-8 font-sans text-stone-950",
          "transition-[opacity,transform] duration-280 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none",
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-4 scale-[0.985] opacity-0",
          className,
        )}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        {title && (
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
        )}
        <div className="text-sm leading-relaxed text-stone-700">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
