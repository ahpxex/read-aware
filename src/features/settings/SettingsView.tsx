import { useState } from "react";
import {
  Caption,
  Stack,
  Select,
  Toggle,
  Radio,
  DefinitionList,
  Button,
  Heading,
  Tabs,
} from "../../components";

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
      <Stack direction="horizontal" gap="md" className="mt-8 flex-wrap">
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

type SettingsViewProps = {
  onBack: () => void;
};

export function SettingsView({ onBack }: SettingsViewProps) {
  return (
    <main className="flex h-screen flex-col bg-stone-100 text-stone-950">
      <header className="shrink-0 bg-stone-100 px-6 pt-6 sm:pt-8">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-4">
          <Button
            variant="link"
            size="sm"
            onClick={onBack}
            className="w-fit text-stone-600 no-underline hover:text-stone-950 hover:no-underline"
          >
            Back to library
          </Button>
          <Heading as="h1" size="2xl">
            Settings
          </Heading>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-screen-2xl px-6 py-8 sm:py-10">
          <Tabs
            ariaLabel="Settings sections"
            defaultIndex={0}
            className="max-w-2xl"
            items={[
              { label: "Reading", content: <ReadingPanel /> },
              { label: "Display", content: <DisplayPanel /> },
              { label: "AI Context", content: <AIContextPanel /> },
              { label: "Account", content: <AccountPanel /> },
            ]}
          />
        </div>
      </div>
    </main>
  );
}
