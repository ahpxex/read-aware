import { useEffect, useId, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { IconButton, ScrollArea } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useLocalAtom } from "@read-aware/ui/state";
import { AIConfigPanel } from "./components/AIConfigPanel";
import { ReaderDisplayPanel } from "./components/ReaderDisplayPanel";

const SECTIONS = ["Reader Display", "AI Configuration"] as const;

type SettingsViewProps = {
  open: boolean;
  onClose: () => void;
};

const EXIT_DURATION_MS = 220;

export function SettingsView({ open, onClose }: SettingsViewProps) {
  const titleId = useId();
  const closeTimerRef = useRef<number | null>(null);
  const [isPresent, setIsPresent] = useLocalAtom(open);
  const [isClosing, setIsClosing] = useLocalAtom(false);
  const [activeIndex, setActiveIndex] = useLocalAtom(0);

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

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPresent, onClose]);

  if (!isPresent) return null;

  const isVisible = open && !isClosing;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 backdrop-blur-sm px-4 py-6 sm:p-8",
        "transition-[opacity,backdrop-filter] duration-220 ease-[var(--ra-ease-out-quart)] motion-reduce:transition-none",
        isVisible ? "opacity-100" : "opacity-0",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "flex h-[min(85vh,32rem)] w-full max-w-3xl overflow-hidden rounded-md border border-border bg-[var(--ra-main-surface-color)]",
          "transition-[opacity,transform] duration-260 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none",
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.985] opacity-0",
        )}
      >
        <aside className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border/70 p-3">
          <h2 id={titleId} className="px-3 pb-2.5 pt-1.5 font-serif text-base font-medium text-stone-900">
            Settings
          </h2>
          {SECTIONS.map((label, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={label}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveIndex(index)}
                className={cn(
                  "relative rounded-md px-3 py-2 text-left font-sans text-sm transition-colors",
                  active ? "font-medium text-stone-900" : "text-stone-500 hover:text-stone-900",
                )}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-stone-900"
                  />
                )}
                {label}
              </button>
            );
          })}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 justify-end px-3 pt-3">
            <IconButton
              label="Close settings"
              size="sm"
              onClick={onClose}
              className="text-stone-500 hover:text-stone-950"
              icon={<X size={14} weight="regular" aria-hidden="true" />}
            />
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-5 pb-7 pt-1 sm:px-6">
              <div className={activeIndex === 0 ? undefined : "hidden"}>
                <ReaderDisplayPanel />
              </div>
              <div className={activeIndex === 1 ? undefined : "hidden"}>
                <AIConfigPanel />
              </div>
            </div>
          </ScrollArea>
        </div>
      </section>
    </div>
  );
}
