import { useEffect, useId, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { IconButton, ScrollArea, Tabs } from "../../components";
import { cn } from "../../components/lib/cn";
import { useLocalAtom } from "../../state/local";
import { AIConfigPanel } from "./components/AIConfigPanel";

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
          "flex h-[min(82vh,42rem)] w-full max-w-3xl flex-col border border-border bg-[var(--ra-main-surface-color)]",
          "transition-[opacity,transform] duration-260 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none",
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.985] opacity-0",
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3 sm:px-6 sm:py-4">
          <h2
            id={titleId}
            className="font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-500"
          >
            Settings
          </h2>
          <IconButton
            label="Close settings"
            size="sm"
            onClick={onClose}
            className="text-stone-500 hover:text-stone-950"
            icon={<X size={14} weight="regular" aria-hidden="true" />}
          />
        </div>

        <ScrollArea className="h-full min-h-0 flex-1">
          <div className="px-5 pt-3 pb-8 sm:px-6 sm:pt-4 sm:pb-10">
            <Tabs
              ariaLabel="Settings sections"
              defaultIndex={0}
              variant="nav"
              className="w-full"
              items={[
                { label: "AI Configuration", content: <AIConfigPanel /> },
              ]}
            />
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
