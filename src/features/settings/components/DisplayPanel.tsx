import { useState } from "react";
import { Caption, Stack, Select, Toggle, Radio } from "../../../components";

export function DisplayPanel() {
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
