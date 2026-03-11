import { useState, useId, useRef } from "react";
import {
  Caption,
  Stack,
  Select,
  Toggle,
  Radio,
  DefinitionList,
  Button,
} from "../../components";
import { cn } from "../../components/lib/cn";

function ArrowLeft() {
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
    >
      <path d="M10 3L5 8l5 5" />
    </svg>
  );
}

const settingsTabs = ["Reading", "Display", "AI Context", "Account"] as const;
type SettingsTab = (typeof settingsTabs)[number];

function ReadingPanel() {
  const [fontSize, setFontSize] = useState("medium");
  const [lineSpacing, setLineSpacing] = useState("comfortable");

  return (
    <Stack gap="lg" className="max-w-md">
      <Select
        label="Font size"
        value={fontSize}
        onChange={setFontSize}
        options={[
          { label: "Small", value: "small" },
          { label: "Medium", value: "medium" },
          { label: "Large", value: "large" },
        ]}
      />
      <Select
        label="Line spacing"
        value={lineSpacing}
        onChange={setLineSpacing}
        options={[
          { label: "Compact", value: "compact" },
          { label: "Comfortable", value: "comfortable" },
          { label: "Relaxed", value: "relaxed" },
        ]}
      />
    </Stack>
  );
}

function DisplayPanel() {
  const [theme, setTheme] = useState("light");

  return (
    <div className="max-w-md">
      <fieldset>
        <Caption as="legend" className="mb-3 text-stone-600">
          Theme
        </Caption>
        <Stack gap="sm">
          <Radio
            label="Light"
            name="theme"
            value="light"
            checked={theme === "light"}
            onChange={() => setTheme("light")}
          />
          <Radio
            label="Warm"
            description="Paper-toned canvas"
            name="theme"
            value="warm"
            checked={theme === "warm"}
            onChange={() => setTheme("warm")}
          />
          <Radio
            label="Dark"
            name="theme"
            value="dark"
            checked={theme === "dark"}
            onChange={() => setTheme("dark")}
          />
        </Stack>
      </fieldset>
    </div>
  );
}

function AIContextPanel() {
  const [autoContext, setAutoContext] = useState(true);
  const [showDefinitions, setShowDefinitions] = useState(true);
  const [contextDepth, setContextDepth] = useState("standard");

  return (
    <Stack gap="lg" className="max-w-md">
      <Toggle
        label="Auto-generate context"
        checked={autoContext}
        onChange={setAutoContext}
      />
      <Toggle
        label="Show inline definitions"
        checked={showDefinitions}
        onChange={setShowDefinitions}
      />
      <Select
        label="Context depth"
        value={contextDepth}
        onChange={setContextDepth}
        options={[
          { label: "Brief", value: "brief" },
          { label: "Standard", value: "standard" },
          { label: "Detailed", value: "detailed" },
        ]}
      />
    </Stack>
  );
}

function AccountPanel() {
  return (
    <div>
      <DefinitionList
        items={[
          { label: "Email", value: "reader@example.com" },
          { label: "Plan", value: "Personal" },
          { label: "Member since", value: "January 2026" },
        ]}
      />
      <Stack direction="horizontal" gap="md" className="mt-8">
        <Button variant="outline" size="sm">
          Export data
        </Button>
        <Button variant="danger" size="sm">
          Delete account
        </Button>
      </Stack>
    </div>
  );
}

const panels: Record<SettingsTab, () => React.JSX.Element> = {
  Reading: ReadingPanel,
  Display: DisplayPanel,
  "AI Context": AIContextPanel,
  Account: AccountPanel,
};

type SettingsViewProps = {
  onBack: () => void;
};

export function SettingsView({ onBack }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("Reading");
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIndex = settingsTabs.indexOf(activeTab);
  const ActivePanel = panels[activeTab];

  function moveFocus(index: number) {
    setActiveTab(settingsTabs[index]);
    tabRefs.current[index]?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
        next = (activeIndex + 1) % settingsTabs.length;
        break;
      case "ArrowLeft":
        next = (activeIndex - 1 + settingsTabs.length) % settingsTabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = settingsTabs.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    moveFocus(next);
  }

  return (
    <main className="flex h-screen flex-col bg-stone-100 text-stone-950">
      <header className="shrink-0 bg-stone-100 px-6 pt-6 sm:px-10 sm:pt-8">
        <div className="mx-auto max-w-5xl xl:max-w-6xl 2xl:max-w-7xl">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-stone-600 transition-colors hover:text-stone-950"
          >
            <ArrowLeft />
            <span className="font-sans text-base font-semibold">Settings</span>
          </button>

          <div
            role="tablist"
            aria-label="Settings"
            onKeyDown={handleKeyDown}
            className="mt-4 flex gap-6 border-b border-border"
          >
            {settingsTabs.map((tab, i) => {
              const isActive = tab === activeTab;
              return (
                <button
                  key={tab}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  id={`${id}-tab-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`${id}-panel-${i}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "font-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
                    "-mb-px border-b-2 pb-3",
                    isActive
                      ? "border-stone-950 text-stone-950"
                      : "border-transparent text-stone-600 hover:text-stone-700",
                  )}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div
          id={`${id}-panel-${activeIndex}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${activeIndex}`}
          className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-10 xl:max-w-6xl 2xl:max-w-7xl"
        >
          <ActivePanel />
        </div>
      </div>
    </main>
  );
}
