import { useState } from "react";
import { Stack, Select, Toggle, Checkbox } from "../../../components";

export function ReadingPanel() {
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
