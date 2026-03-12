import { useEffect, useRef, useId, type ReactNode } from "react";
import { useLocalAtom } from "../state/local";
import { cn } from "./lib/cn";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
};

const EXIT_DURATION_MS = 220;

export function Dialog({
  open,
  onClose,
  title,
  "aria-label": ariaLabel,
  children,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const closeTimerRef = useRef<number | null>(null);
  const [isPresent, setIsPresent] = useLocalAtom(open);
  const [isClosing, setIsClosing] = useLocalAtom(false);

  useEffect(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (open) {
      setIsPresent(true);
      setIsClosing(false);
      return;
    }

    if (!isPresent) return;

    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      const dialog = ref.current;
      if (dialog?.open) dialog.close();
      setIsClosing(false);
      setIsPresent(false);
      closeTimerRef.current = null;
    }, EXIT_DURATION_MS);
  }, [open, isPresent, setIsClosing, setIsPresent]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isPresent) return;
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
  }, [isPresent]);

  // Lock body scroll when open
  useEffect(() => {
    if (!isPresent) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isPresent]);

  if (!isPresent) return null;

  const isVisible = open && !isClosing;

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      data-state={isVisible ? "open" : "closed"}
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
      className={cn(
        "ra-dialog m-auto max-w-lg border border-border bg-[var(--ra-main-surface-color)] p-8 font-sans text-stone-950",
        "transition-[opacity,transform] duration-260 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none",
        isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.985] opacity-0",
        "open:flex open:flex-col open:gap-4",
        className,
      )}
    >
      {title && (
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
      )}
      <div className="text-sm leading-relaxed text-stone-700">{children}</div>
    </dialog>
  );
}
