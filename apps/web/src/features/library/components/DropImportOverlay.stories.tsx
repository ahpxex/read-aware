import type { Meta, StoryObj } from "@storybook/react-vite";
import { DropImportOverlay } from "./DropImportOverlay";

/**
 * The hint shown while book files hover over the window.
 *
 * It covers the whole window but is `pointer-events-none` throughout: the drag
 * events have to keep reaching the window listeners in `useDropBookImport`, so
 * this overlay announces and never intercepts.
 */
const meta = {
  title: "Interface/Library/DropImportOverlay",
  component: DropImportOverlay,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DropImportOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The overlay on its own. */
export const Default: Story = {};

/** Over a populated shelf, which is what it actually veils. */
export const OverTheShelf: Story = {
  render: (args) => (
    <div className="min-h-screen bg-[var(--ra-main-surface-color)] p-8">
      <h1 className="font-serif text-2xl text-fg">Library</h1>
      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-6">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="aspect-[2/3] rounded-sm border border-border bg-fill" />
        ))}
      </div>
      <DropImportOverlay {...args} />
    </div>
  ),
};
