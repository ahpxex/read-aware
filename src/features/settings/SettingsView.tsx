import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NavItem, Tabs } from "../../components";
import { ReadingPanel } from "./components/ReadingPanel";
import { DisplayPanel } from "./components/DisplayPanel";
import { AIContextPanel } from "./components/AIContextPanel";
import { AccountPanel } from "./components/AccountPanel";

function ChevronLeft() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3L5 8l5 5" />
    </svg>
  );
}

type SettingsViewProps = {
  onBack: () => void;
};

export function SettingsView({ onBack }: SettingsViewProps) {
  return (
    <>
      <header
        className="shrink-0 border-b border-border bg-stone-100 px-6 pt-6 pb-5 sm:pt-8"
        onMouseDown={(e: MouseEvent<HTMLElement>) => {
          const tag = (e.target as HTMLElement).closest(
            "button, a, input, textarea, select, label, [role='tab'], [role='switch']",
          );
          if (e.buttons === 1 && !tag) {
            try {
              e.detail === 2
                ? getCurrentWindow().toggleMaximize()
                : getCurrentWindow().startDragging();
            } catch {
              // No Tauri runtime (e.g. Storybook) -- ignore
            }
          }
        }}
      >
        <div className="mx-auto flex max-w-screen-2xl">
          <NavItem
            active
            onClick={onBack}
            className="inline-flex items-center gap-1.5"
          >
            <ChevronLeft />
            Settings
          </NavItem>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-screen-2xl px-6 py-8 sm:py-10">
          <Tabs
            ariaLabel="Settings sections"
            defaultIndex={0}
            stretch
            className="w-full"
            items={[
              { label: "Reading", content: <ReadingPanel /> },
              { label: "Display", content: <DisplayPanel /> },
              { label: "AI Context", content: <AIContextPanel /> },
              { label: "Account", content: <AccountPanel /> },
            ]}
          />
        </div>
      </div>
    </>
  );
}
