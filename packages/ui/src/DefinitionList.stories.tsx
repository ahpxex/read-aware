import type { Meta, StoryObj } from "@storybook/react-vite";
import { DefinitionList } from "./DefinitionList";

const meta = {
  title: "Design System/Components/DefinitionList",
  component: DefinitionList,
  argTypes: {
    columns: { control: "select", options: [1, 2, 3] },
  },
} satisfies Meta<typeof DefinitionList>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleItems = [
  {
    label: "Rhythm",
    value: "Wide spacing and a single left edge make the reading list easy to scan.",
  },
  {
    label: "Surface",
    value: "A paper-toned canvas replaces cards, glow, and extra containers.",
  },
  {
    label: "Signal",
    value: "Typography carries hierarchy so the interface can stay visually spare.",
  },
];

export const ThreeColumns: Story = {
  args: { items: sampleItems, columns: 3 },
};

export const TwoColumns: Story = {
  args: { items: sampleItems, columns: 2 },
};

export const SingleColumn: Story = {
  args: { items: sampleItems, columns: 1 },
};

export const LongIdentifiers: Story = {
  args: {
    variant: "inline",
    items: [
      { label: "Book", value: "Composition 88c607e9" },
      {
        label: "Source version",
        value: "sha256:fdfc6932a5e03e05f52dfc45764f333f122fb6782490e9e877edbabc0295bb49",
      },
      { label: "UnbrokenLabel".repeat(8), value: "UnbrokenValue".repeat(8) },
    ],
  },
  decorators: [(Story) => <div style={{ width: 320, maxWidth: "100%" }}><Story /></div>],
};
