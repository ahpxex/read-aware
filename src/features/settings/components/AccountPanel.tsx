import {
  Stack,
  Select,
  Toggle,
  Checkbox,
  TextField,
  DefinitionList,
  Button,
} from "../../../components";
import { useLocalAtom } from "../../../state/local";

export function AccountPanel() {
  const [displayName, setDisplayName] = useLocalAtom("Reader");
  const [timezone, setTimezone] = useLocalAtom("asia-shanghai");
  const [dataExportFormat, setDataExportFormat] = useLocalAtom("markdown");
  const [syncFrequency, setSyncFrequency] = useLocalAtom("hourly");
  const [weeklyDigest, setWeeklyDigest] = useLocalAtom(true);
  const [productUpdates, setProductUpdates] = useLocalAtom(false);
  const [usageAnalytics, setUsageAnalytics] = useLocalAtom(true);

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
