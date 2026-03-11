import { type MouseEvent, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  Checkbox,
  TextField,
  IconButton,
} from "../../components";

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

function ReadingPanel() {
  const [fontSize, setFontSize] = useState("medium");
  const [lineSpacing, setLineSpacing] = useState("comfortable");
  const [readingWidth, setReadingWidth] = useState("balanced");
  const [paragraphSpacing, setParagraphSpacing] = useState("balanced");
  const [dailyGoal, setDailyGoal] = useState("30");
  const [showProgressBar, setShowProgressBar] = useState(true);
  const [resumeWhereLeftOff, setResumeWhereLeftOff] = useState(true);
  const [showStreaks, setShowStreaks] = useState(true);

  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
      <Stack gap="lg">
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
        <Select
          label="Reading width"
          value={readingWidth}
          onChange={setReadingWidth}
          options={[
            { label: "Narrow", value: "narrow" },
            { label: "Balanced", value: "balanced" },
            { label: "Wide", value: "wide" },
          ]}
        />
      </Stack>

      <Stack gap="lg">
        <Select
          label="Paragraph spacing"
          value={paragraphSpacing}
          onChange={setParagraphSpacing}
          options={[
            { label: "Tight", value: "tight" },
            { label: "Balanced", value: "balanced" },
            { label: "Spacious", value: "spacious" },
          ]}
        />
        <Select
          label="Daily goal (minutes)"
          value={dailyGoal}
          onChange={setDailyGoal}
          options={[
            { label: "15", value: "15" },
            { label: "30", value: "30" },
            { label: "45", value: "45" },
            { label: "60", value: "60" },
          ]}
        />
        <Toggle
          label="Show chapter progress bar"
          checked={showProgressBar}
          onChange={setShowProgressBar}
        />
        <Checkbox
          label="Resume where I left off"
          checked={resumeWhereLeftOff}
          onChange={(e) => setResumeWhereLeftOff(e.target.checked)}
        />
        <Toggle
          label="Show reading streak reminders"
          checked={showStreaks}
          onChange={setShowStreaks}
        />
      </Stack>
    </div>
  );
}

function DisplayPanel() {
  const [theme, setTheme] = useState("light");
  const [bodyTypeface, setBodyTypeface] = useState("inter");
  const [contrast, setContrast] = useState("standard");
  const [pageDensity, setPageDensity] = useState("comfortable");
  const [showPageNumbers, setShowPageNumbers] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [justifyParagraphs, setJustifyParagraphs] = useState(false);
  const [autoBrightness, setAutoBrightness] = useState(true);

  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
      <Stack gap="lg">
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
        <Select
          label="Body typeface"
          value={bodyTypeface}
          onChange={setBodyTypeface}
          options={[
            { label: "Inter", value: "inter" },
            { label: "Source Sans", value: "source-sans" },
            { label: "System Sans", value: "system-sans" },
          ]}
        />
        <Select
          label="Contrast"
          value={contrast}
          onChange={setContrast}
          options={[
            { label: "Standard", value: "standard" },
            { label: "Higher", value: "high" },
            { label: "Maximum", value: "max" },
          ]}
        />
      </Stack>

      <Stack gap="lg">
        <Select
          label="Page density"
          value={pageDensity}
          onChange={setPageDensity}
          options={[
            { label: "Compact", value: "compact" },
            { label: "Comfortable", value: "comfortable" },
            { label: "Relaxed", value: "relaxed" },
          ]}
        />
        <Toggle
          label="Show page numbers"
          checked={showPageNumbers}
          onChange={setShowPageNumbers}
        />
        <Toggle
          label="Reduce motion"
          checked={reduceMotion}
          onChange={setReduceMotion}
        />
        <Toggle
          label="Justify paragraphs"
          checked={justifyParagraphs}
          onChange={setJustifyParagraphs}
        />
        <Toggle
          label="Auto-adjust brightness"
          checked={autoBrightness}
          onChange={setAutoBrightness}
        />
      </Stack>
    </div>
  );
}

function AIContextPanel() {
  const [autoContext, setAutoContext] = useState(true);
  const [showDefinitions, setShowDefinitions] = useState(true);
  const [contextDepth, setContextDepth] = useState("standard");
  const [citationStyle, setCitationStyle] = useState("inline");
  const [recommendationCadence, setRecommendationCadence] = useState("balanced");
  const [crossBookLinks, setCrossBookLinks] = useState(true);
  const [askBeforeMemoryWrite, setAskBeforeMemoryWrite] = useState(false);
  const [saveKeyInsights, setSaveKeyInsights] = useState(true);

  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
      <Stack gap="lg">
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
        <Toggle
          label="Show cross-book references"
          checked={crossBookLinks}
          onChange={setCrossBookLinks}
        />
        <Toggle
          label="Save key insights to memory"
          checked={saveKeyInsights}
          onChange={setSaveKeyInsights}
        />
      </Stack>

      <Stack gap="lg">
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
        <Select
          label="Citation style"
          value={citationStyle}
          onChange={setCitationStyle}
          options={[
            { label: "Inline notes", value: "inline" },
            { label: "Side references", value: "side" },
            { label: "End references", value: "end" },
          ]}
        />
        <Select
          label="Recommendation cadence"
          value={recommendationCadence}
          onChange={setRecommendationCadence}
          options={[
            { label: "Minimal", value: "minimal" },
            { label: "Balanced", value: "balanced" },
            { label: "Frequent", value: "frequent" },
          ]}
        />
        <Toggle
          label="Ask before writing long-term memory"
          checked={askBeforeMemoryWrite}
          onChange={setAskBeforeMemoryWrite}
        />
      </Stack>
    </div>
  );
}

function AccountPanel() {
  const [displayName, setDisplayName] = useState("Reader");
  const [timezone, setTimezone] = useState("asia-shanghai");
  const [dataExportFormat, setDataExportFormat] = useState("markdown");
  const [syncFrequency, setSyncFrequency] = useState("hourly");
  const [weeklyDigest, setWeeklyDigest] = useState(true);
  const [productUpdates, setProductUpdates] = useState(false);
  const [usageAnalytics, setUsageAnalytics] = useState(true);

  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
      <Stack gap="lg">
        <TextField
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Reader"
        />
        <Select
          label="Timezone"
          value={timezone}
          onChange={setTimezone}
          options={[
            { label: "Asia/Shanghai", value: "asia-shanghai" },
            { label: "America/Los_Angeles", value: "america-los-angeles" },
            { label: "Europe/London", value: "europe-london" },
          ]}
        />
        <Select
          label="Export format"
          value={dataExportFormat}
          onChange={setDataExportFormat}
          options={[
            { label: "Markdown bundle", value: "markdown" },
            { label: "JSON archive", value: "json" },
            { label: "CSV snapshots", value: "csv" },
          ]}
        />
      </Stack>

      <Stack gap="lg">
        <Select
          label="Sync frequency"
          value={syncFrequency}
          onChange={setSyncFrequency}
          options={[
            { label: "Every 15 minutes", value: "15m" },
            { label: "Hourly", value: "hourly" },
            { label: "Every 6 hours", value: "6h" },
          ]}
        />
        <Toggle
          label="Weekly reading digest"
          checked={weeklyDigest}
          onChange={setWeeklyDigest}
        />
        <Toggle
          label="Product updates"
          checked={productUpdates}
          onChange={setProductUpdates}
        />
        <Checkbox
          label="Share anonymous usage analytics"
          checked={usageAnalytics}
          onChange={(e) => setUsageAnalytics(e.target.checked)}
        />
      </Stack>

      <DefinitionList
        className="md:col-span-2"
        items={[
          { label: "Email", value: "reader@example.com" },
          { label: "Plan", value: "Personal" },
          { label: "Member since", value: "January 2026" },
        ]}
      />

      <Stack direction="horizontal" gap="md" className="md:col-span-2 flex-wrap">
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
      <header
        className="shrink-0 border-b border-border bg-stone-100 px-6 pt-6 pb-5 sm:pt-8"
        onMouseDown={(e: MouseEvent<HTMLElement>) => {
          const tag = (e.target as HTMLElement).closest(
            "button, a, input, textarea, select, label, [role='tab'], [role='switch']",
          );
          if (e.buttons === 1 && !tag) {
            e.detail === 2
              ? getCurrentWindow().toggleMaximize()
              : getCurrentWindow().startDragging();
          }
        }}
      >
        <div className="mx-auto flex max-w-screen-2xl items-center gap-1.5">
          <IconButton
            icon={<ChevronLeft />}
            label="Back to library"
            size="sm"
            onClick={onBack}
            className="text-stone-600 hover:text-stone-950"
          />
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
    </main>
  );
}
