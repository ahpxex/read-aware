import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocalAtom } from "./lib/useLocalAtom";
import { Select } from "./Select";

const sampleOptions = [
  { label: "Date added", value: "date" },
  { label: "Title", value: "title" },
  { label: "Author", value: "author" },
  { label: "Rating", value: "rating" },
];

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
  render: () => {
    const [value, setValue] = useLocalAtom("title");
    return (
      <div className="flex flex-col gap-4">
        <Select
          label="Sort by"
          options={sampleOptions}
          value={value}
          onChange={setValue}
        />
        <p className="text-sm text-stone-500">Selected: {value}</p>
      </div>
    );
  },
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
