import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScrollArea } from "@read-aware/ui";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { writeTocPins } from "../lib/toc-folds";
import type { TocEntry } from "../lib/reader-types";
import OverlayStories from "./ReaderShellOverlay.stories";
import { ReaderTocList } from "./ReaderTocList";

/** Pale Fire's contents, from the shell stories: one branch (the poem's cantos). */
const paleFire = OverlayStories.args.tocEntries;

/**
 * A three-level contents: books, then chapters, then sections — the shape a
 * long work's contents takes, where folding is what keeps it readable.
 */
const parts: [part: string, chapters: [chapter: string, ...sections: string[]][]][] = [
  ["Book One: Swann's Way", [["Combray", "Overture", "The Madeleine"], ["Swann in Love"], ["Place-Names: The Name"]]],
  [
    "Book Two: In the Shadow of Young Girls in Flower",
    [
      ["Madame Swann at Home", "Gilberte", "Bergotte"],
      ["Place-Names: The Place", "Balbec", "The Little Band"],
    ],
  ],
  ["Book Three: The Guermantes Way", [["Part One"], ["Part Two", "Grandmother's Illness", "Her Death"]]],
];
const deep: TocEntry[] = [];
for (const [part, chapters] of parts) {
  const partIndex = deep.length;
  deep.push({ id: `p${partIndex}`, href: `part${partIndex}.xhtml`, label: part, depth: 0, spineIndex: partIndex });
  for (const [chapter, ...sections] of chapters) {
    const at = deep.length;
    deep.push({ id: `c${at}`, href: `ch${at}.xhtml`, label: chapter, depth: 1, spineIndex: at });
    for (const section of sections)
      deep.push({
        id: `s${deep.length}`,
        href: `ch${at}.xhtml#s${deep.length}`,
        label: section,
        depth: 2,
        spineIndex: at,
      });
  }
}
const indexOf = (label: string) => deep.findIndex((entry) => entry.label === label);

/** Folds the reader pinned open are remembered per book: each story starts with none. */
const bookId = "story-toc-folds";
const noPins = async () => {
  await writeTocPins(bookId, [], new Set());
  return async () => {
    await writeTocPins(bookId, [], new Set());
  };
};

/**
 * The book's foldable table of contents, as the side panel's contents view
 * shows it. Branches are folded except the path to the current chapter (and
 * any the reader pinned open); a folded branch holding the current chapter
 * stands in for it. Windowed, so the list scrolls inside the panel.
 */
const meta = {
  title: "Interface/Reader/ReaderTocList",
  component: ReaderTocList,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <ScrollArea className="h-[32rem] w-72 border-r border-border-strong/70 bg-[var(--ra-main-surface-color)]">
        <div className="flex flex-col py-4">
          <Story />
        </div>
      </ScrollArea>
    ),
  ],
  args: {
    bookId,
    entries: deep,
    activeIndex: indexOf("Bergotte"),
    revealing: true,
    onSelect: fn(),
  },
  beforeEach: noPins,
} satisfies Meta<typeof ReaderTocList>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Three levels, folded: only the current section's path (Book Two → Madame
 * Swann at Home) is open, with the section itself marked.
 */
export const FoldedLevels: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Bergotte" })).toHaveAttribute("aria-current", "location");
    await expect(canvas.getByRole("button", { name: "Expand Book One: Swann's Way" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(canvas.queryByRole("button", { name: "Combray" })).not.toBeInTheDocument();
  },
};

/** Unfolding a branch shows the next level down, and the list remembers it for the book. */
export const Expanding: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Expand Book One: Swann's Way" }));
    await expect(await canvas.findByRole("button", { name: "Combray" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Expand Combray" }));
    await expect(await canvas.findByRole("button", { name: "The Madeleine" })).toBeVisible();
  },
};

/**
 * Folding the current chapter's own path: the folded branch above it is
 * marked in its place, so the reader can still see where they are.
 */
export const CurrentInsideFoldedBranch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Collapse Book Two: In the Shadow of Young Girls in Flower" }),
    );
    await waitFor(() => expect(canvas.queryByRole("button", { name: "Bergotte" })).not.toBeInTheDocument());
    await expect(
      canvas.getByRole("button", { name: "Expand Book Two: In the Shadow of Young Girls in Flower" }),
    ).toHaveAttribute("aria-expanded", "false");
  },
};

/** Branches the reader pinned open stay open beside the current path. */
export const PinnedOpen: Story = {
  beforeEach: async () => {
    const clear = await noPins();
    await writeTocPins(
      bookId,
      [`p${indexOf("Book Three: The Guermantes Way")}`],
      new Set(deep.map((entry) => entry.id)),
    );
    return clear;
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("button", { name: "Part Two" })).toBeVisible();
  },
};

/** No chapter is current (a position the contents don't cover): every branch folded. */
export const NoCurrentChapter: Story = {
  args: { activeIndex: -1 },
};

/** A shallow book: Pale Fire, its one branch (the poem) folded away from the current chapter. */
export const Shallow: Story = {
  args: { entries: paleFire, activeIndex: paleFire.findIndex((entry) => entry.href === "commentary.xhtml") },
};

/** A set's contents can run to thousands of entries; only the rows in view are mounted. */
export const ThousandsOfEntries: Story = {
  args: {
    entries: Array.from({ length: 4000 }, (_, index) => ({
      id: `n${index}`,
      href: `ch${index}.xhtml`,
      label: `Chapter ${index + 1}`,
      depth: 0,
      spineIndex: index,
    })),
    activeIndex: 2400,
  },
  play: async ({ canvasElement }) => {
    // Revealed and centered on the current chapter, far down the list.
    await expect(await within(canvasElement).findByRole("button", { name: "Chapter 2401" })).toHaveAttribute(
      "aria-current",
      "location",
    );
  },
};

/** A file without navigable contents says so instead of showing a blank panel. */
export const NoContents: Story = {
  args: { entries: [], activeIndex: -1 },
};
