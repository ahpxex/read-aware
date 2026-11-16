import type { Meta, StoryObj } from "@storybook/react-vite";
import { FixedLayoutFitChoice } from "./FixedLayoutZoomControls";

/**
 * What a fixed-layout page's 100% fits to: its width or the whole page.
 * Choosing one returns the zoom to that fit. A book with no remembered zoom
 * fits the whole page when paged and the page width when scrolled, which is
 * what these stories show: the book id has no entry in this device's zoom
 * memory.
 *
 * The choice reads and writes the per-book zoom memory (`domain/reading-zoom`),
 * which is device-local storage observed by the app's default jotai store.
 * A click here writes this Storybook origin's localStorage, and the story's
 * own store does not observe that write, so the selection only moves after a
 * reload. The same control appears in context in the fixed-layout stories of
 * ReaderAppearanceMenu (with its legend) and ReaderAppearanceCompact (inline).
 */
const meta = {
  title: "Interface/Reader/FixedLayoutFitChoice",
  component: FixedLayoutFitChoice,
  parameters: { layout: "centered" },
  args: { bookId: "story-fixed-layout-unzoomed", scrolled: false },
} satisfies Meta<typeof FixedLayoutFitChoice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A paged book on its default fit: the whole page. */
export const Paged: Story = {};

/** A scrolled book on its default fit: the page width. */
export const Scrolled: Story = { args: { scrolled: true } };

/**
 * Inline in a list row (the compact appearance sheet): the row names the
 * setting, so the choices carry an accessible name but no legend.
 */
export const Inline: Story = { args: { inline: true } };
