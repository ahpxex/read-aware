import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocalAtom } from "./lib/useLocalAtom";
import { TimeField } from "./TimeField";

const meta = {
  title: "Design System/Components/TimeField",
  component: TimeField,
} satisfies Meta<typeof TimeField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Day starts at", value: "07:00" },
  render: (args) => {
    const [value, setValue] = useLocalAtom(args.value ?? "");
    return <TimeField {...args} value={value} onChange={setValue} />;
  },
};

export const WithHelperText: Story = {
  args: {
    label: "Night starts at",
    value: "19:00",
    helperText: "Runs until the day slot starts again.",
  },
  render: (args) => {
    const [value, setValue] = useLocalAtom(args.value ?? "");
    return <TimeField {...args} value={value} onChange={setValue} />;
  },
};

/** Finer granularity for schedules that care about the quarter hour. */
export const MinuteSteps: Story = {
  args: { label: "Reminder at", value: "21:45", minuteStep: 15 },
  render: (args) => {
    const [value, setValue] = useLocalAtom(args.value ?? "");
    return <TimeField {...args} value={value} onChange={setValue} />;
  },
};

/** An unparseable stored value reads as unset rather than as midnight. */
export const Unset: Story = {
  args: { label: "Starts at", value: "" },
  render: (args) => {
    const [value, setValue] = useLocalAtom(args.value ?? "");
    return <TimeField {...args} value={value} onChange={setValue} />;
  },
};

export const WithError: Story = {
  args: { label: "Starts at", value: "07:00", error: "Pick a different time." },
};
