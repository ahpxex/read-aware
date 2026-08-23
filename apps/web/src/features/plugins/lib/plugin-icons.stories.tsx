import type { Meta, StoryObj } from "@storybook/react-vite";
import { PLUGIN_ICON_NAMES, renderPluginIcon } from "./plugin-icons";

/**
 * The curated icon set plugins may reference by name. Plugins never ship SVG —
 * they name an icon, and the host resolves it here, which keeps the Phosphor
 * import tree-shakeable and the visual language consistent.
 *
 * This gallery is the contract made visible: it is the list a plugin author
 * can choose from, and adding a name to the map adds it here.
 */
const meta = {
  title: "Interface/Plugins/PluginIcons",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Gallery({ size, weight }: { size: number; weight?: "regular" | "bold" | "fill" }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-y-5">
      {PLUGIN_ICON_NAMES.map((name) => (
        <div key={name} className="flex flex-col items-center gap-1.5 text-fg">
          {renderPluginIcon(name, size, weight)}
          <code className="text-[10px] text-fg-muted">{name}</code>
        </div>
      ))}
    </div>
  );
}

/** Every name in the curated set, at the default size. */
export const AllIcons: Story = {
  render: () => <Gallery size={20} />,
};

/** The sizes the host actually asks for: 13, 14, 15 and 16px. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-8">
      {[13, 14, 15, 16, 20, 24].map((size) => (
        <div key={size} className="flex flex-col items-center gap-2 text-fg">
          {renderPluginIcon("book-open", size)}
          <code className="text-[10px] text-fg-muted">{size}px</code>
        </div>
      ))}
    </div>
  ),
};

/** Weights, for the rare surface that inks an icon harder. */
export const Weights: Story = {
  render: () => (
    <div className="flex items-end gap-8">
      {(["regular", "bold", "fill"] as const).map((weight) => (
        <div key={weight} className="flex flex-col items-center gap-2 text-fg">
          {renderPluginIcon("star", 24, weight)}
          <code className="text-[10px] text-fg-muted">{weight}</code>
        </div>
      ))}
    </div>
  ),
};

/**
 * The fallback path: an unknown name — a typo, or an icon from a newer host —
 * resolves to the puzzle piece, so a third-party entry stays recognizable
 * instead of rendering a hole.
 */
export const UnknownAndMissingNames: Story = {
  render: () => (
    <div className="flex items-end gap-8">
      {[
        { label: '"not-a-real-icon"', name: "not-a-real-icon" },
        { label: "undefined", name: undefined },
        { label: '"" (empty)', name: "" },
      ].map((entry) => (
        <div key={entry.label} className="flex flex-col items-center gap-2 text-fg">
          {renderPluginIcon(entry.name, 24)}
          <code className="text-[10px] text-fg-muted">{entry.label}</code>
        </div>
      ))}
    </div>
  ),
};
