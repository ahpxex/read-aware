import { useEffect, useId } from "react";
import { X } from "@phosphor-icons/react";
import { IconButton, Tabs } from "../../components";
import { ReadingPanel } from "./components/ReadingPanel";
import { DisplayPanel } from "./components/DisplayPanel";
import { AIContextPanel } from "./components/AIContextPanel";
import { AccountPanel } from "./components/AccountPanel";

type SettingsViewProps = {
  onClose: () => void;
};

export function SettingsView({ onClose }: SettingsViewProps) {
  const titleId = useId();

  useEffect(() => {
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
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 px-4 py-6 sm:p-8"
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
        className="flex h-[min(82vh,42rem)] w-full max-w-4xl flex-col border border-border bg-paper"
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-8 sm:px-6 sm:pt-4 sm:pb-10">
          <Tabs
            ariaLabel="Settings sections"
            defaultIndex={0}
            variant="nav"
            className="w-full"
            items={[
              { label: "Reading", content: <ReadingPanel /> },
              { label: "Display", content: <DisplayPanel /> },
              { label: "AI Context", content: <AIContextPanel /> },
              { label: "Account", content: <AccountPanel /> },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
