import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScrollArea } from "./ScrollArea";

const meta = {
  title: "Design System/Components/ScrollArea",
  component: ScrollArea,
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ScrollArea className="h-48 w-64 border border-border p-4">
      <div className="flex flex-col gap-2 font-sans text-sm text-stone-700">
        {Array.from({ length: 20 }, (_, i) => (
          <p key={i}>Item {i + 1}</p>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <ScrollArea className="h-24 w-64 border border-border p-4">
      <div className="flex w-[800px] gap-3">
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="flex h-12 w-16 shrink-0 items-center justify-center bg-stone-100 font-sans text-caption text-stone-500"
          >
            {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};
