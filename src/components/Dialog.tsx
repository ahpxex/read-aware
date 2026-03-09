import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./lib/cn";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
};

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={cn(
        "m-auto max-w-lg border border-border bg-paper p-8 font-sans text-stone-950 backdrop:bg-stone-950/20",
        "open:flex open:flex-col open:gap-4",
        className,
      )}
    >
      {title && (
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      )}
      <div className="text-sm leading-relaxed text-stone-700">{children}</div>
    </dialog>
  );
}
