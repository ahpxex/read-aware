import { Stack, Select, Toggle } from "../../../components";
import { useLocalAtom } from "../../../state/local";

export function AIContextPanel() {
  const [autoContext, setAutoContext] = useLocalAtom(true);
  const [showDefinitions, setShowDefinitions] = useLocalAtom(true);
  const [contextDepth, setContextDepth] = useLocalAtom("standard");
  const [citationStyle, setCitationStyle] = useLocalAtom("inline");
  const [recommendationCadence, setRecommendationCadence] = useLocalAtom("balanced");
  const [crossBookLinks, setCrossBookLinks] = useLocalAtom(true);
  const [askBeforeMemoryWrite, setAskBeforeMemoryWrite] = useLocalAtom(false);
  const [saveKeyInsights, setSaveKeyInsights] = useLocalAtom(true);

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
