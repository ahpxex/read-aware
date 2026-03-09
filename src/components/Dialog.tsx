import { useEffect, useRef, useId, type ReactNode } from "react";
import { cn } from "./lib/cn";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
};

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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
      className={cn(
        "m-auto max-w-lg border border-border bg-paper p-8 font-sans text-stone-950 backdrop:bg-stone-950/20",
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
