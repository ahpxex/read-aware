import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocalAtom } from "./lib/useLocalAtom";
import { expect, userEvent, within } from "storybook/test";
import { Select } from "./Select";

const sampleOptions = [
  { label: "Date added", value: "date" },
  { label: "Title", value: "title" },
  { label: "Author", value: "author" },
  { label: "Rating", value: "rating" },
];

function ControlledSelect() {
  const [value, setValue] = useLocalAtom("title");
  return (
    <div className="flex flex-col gap-4">
      <Select label="Sort by" options={sampleOptions} value={value} onChange={setValue} />
      <p className="text-sm text-fg-muted">Selected: {value}</p>
    </div>
  );
}

const meta = {
  title: "Design System/Components/Select",
  component: Select,
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Sort by",
    options: sampleOptions,
    defaultValue: "date",
  },
};

export const WithPlaceholder: Story = {
  args: {
    label: "Category",
    options: sampleOptions,
    placeholder: "Choose a category...",
  },
};

export const WithHelperText: Story = {
  args: {
    label: "Sort by",
    options: sampleOptions,
    defaultValue: "date",
    helperText: "Controls the order of your reading list",
  },
};

export const WithError: Story = {
  args: {
    label: "Genre",
    options: sampleOptions,
    placeholder: "Select a genre...",
    error: "Please select a genre",
  },
};

export const Outlined: Story = {
  args: {
    label: "Sort by",
    options: sampleOptions,
    defaultValue: "date",
    variant: "outlined",
  },
};

export const OutlinedWithError: Story = {
  args: {
    label: "Genre",
    options: sampleOptions,
    placeholder: "Select a genre...",
    variant: "outlined",
    error: "Please select a genre",
  },
};

export const Controlled: Story = {
  render: () => <ControlledSelect />,
  args: {
    label: "",
    options: [],
  },
};

export const Disabled: Story = {
  args: {
    label: "Sort by",
    options: sampleOptions,
    defaultValue: "date",
    disabled: true,
  },
};

/**
 * A header row pinned above the options and an accessory inside each option —
 * the shape a picker uses for "Import…" plus per-row file facts.
 */
export const WithPopupHeaderAndAccessories: Story = {
  args: {
    label: "Font",
    defaultValue: "serif",
    options: [
      {
        label: "JetBrains Mono",
        value: "mono",
        accessory: <span className="text-[11px] text-fg-subtle">WOFF · 27 KB</span>,
      },
      {
        label: "Source Serif 4",
        value: "serif",
        accessory: <span className="text-[11px] text-fg-subtle">OTF · 236 KB</span>,
      },
    ],
    popupHeader: (close) => (
      <button
        type="button"
        onClick={close}
        className="mb-1 flex w-full items-center gap-2 rounded-md border-b border-border px-2.5 pb-2 pt-1.5 text-left text-sm text-fg-muted transition-colors hover:bg-fill hover:text-fg"
      >
        Import font…
      </button>
    ),
  },
};

/** Pointer opening and keyboard opening start on the same selected option. */
export const KeyboardAfterPointerOpen: Story = {
  args: { label: "Sort by", options: sampleOptions, defaultValue: "date" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", { name: "Sort by" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(trigger).toHaveTextContent("Title");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  },
};
