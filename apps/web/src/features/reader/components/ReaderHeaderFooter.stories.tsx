import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  defaultHeaderFooterSettings,
  type HeaderFooterItem,
  type HeaderFooterPosition,
} from "../../../domain/settings/header-footer-settings";
import { BUILTIN_READER_PALETTES } from "../../settings";
import { READER_STRIP_HEIGHT_PX, resolveHeaderFooterLayout } from "../lib/header-footer-layout";
import { ReaderHeaderFooter } from "./ReaderHeaderFooter";

const EMPTY_SLOTS: Record<HeaderFooterPosition, HeaderFooterItem[]> = {
  "header-left": [],
  "header-center": [],
  "header-right": [],
  "footer-left": [],
  "footer-center": [],
  "footer-right": [],
};

/**
 * The strips for an arrangement, resolved as the reader resolves them on a
 * desktop browser: no battery reading, so a placed battery item drops out.
 */
function layoutFor(slots: Partial<Record<HeaderFooterPosition, HeaderFooterItem[]>>) {
  return resolveHeaderFooterLayout({ enabled: true, slots: { ...EMPTY_SLOTS, ...slots } }, { batteryAvailable: false });
}

/**
 * The reader's header and footer strips: thin status lines above and below
 * the page, arranged in Settings → Menus (see HeaderFooterEditor). They paint
 * with the page palette and fade, keeping their space, while the reader
 * controls are up.
 *
 * The clock shows the real time. The battery item only renders on Android and
 * iOS, where the platform reports one; a browser preview never shows it.
 */
const meta = {
  title: "Interface/Reader/ReaderHeaderFooter",
  component: ReaderHeaderFooter,
  parameters: { layout: "padded" },
  args: {
    layout: resolveHeaderFooterLayout({ ...defaultHeaderFooterSettings(), enabled: true }, { batteryAvailable: false }),
    palette: BUILTIN_READER_PALETTES.light,
    dimmed: false,
    bookTitle: "Invisible Cities",
    chapterTitle: "Cities & Memory 2",
    progress: 0.42,
    currentPage: 61,
    totalPages: 146,
  },
  decorators: [
    (Story, { args }) => (
      // The strips sit absolutely at the top and bottom of the reader canvas;
      // the frame stands in for it, painted with the page palette, and keeps
      // the text clear of the strips' reserved height as the paginator does.
      <div
        className="relative mx-auto h-[30rem] max-w-2xl overflow-hidden rounded-lg border border-border"
        style={{ background: args.palette.bg, color: args.palette.text }}
      >
        <div
          className="space-y-4 px-10 font-serif text-base leading-7"
          style={{ paddingTop: READER_STRIP_HEIGHT_PX + 24, paddingBottom: READER_STRIP_HEIGHT_PX + 24 }}
        >
          <p>
            Stand-in page text. The strips borrow their height from the page margin, so text that already fits never
            reflows when a strip is turned on or off.
          </p>
          <p>
            Each strip holds three slots, left, center and right, and each slot holds the items placed there in the
            order they were arranged.
          </p>
        </div>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReaderHeaderFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default arrangement: chapter top-left; time bottom-left, progress bottom-right. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Header")).toHaveTextContent("Cities & Memory 2");
    await expect(canvas.getByLabelText("Footer")).toHaveTextContent("42%");
  },
};

/**
 * Every item a desktop can show, with the book title centered in the header
 * and two items sharing the bottom-right slot, joined by a dot.
 */
export const EveryItem: Story = {
  args: {
    layout: layoutFor({
      "header-left": ["chapter"],
      "header-center": ["bookTitle"],
      "footer-left": ["time"],
      "footer-right": ["pages", "progress"],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Header")).toHaveTextContent("Invisible Cities");
    await expect(canvas.getByLabelText("Footer")).toHaveTextContent("61 / 146");
  },
};

/**
 * Long titles: the center item shrinks and truncates instead of colliding
 * with the flanks, and each flank truncates within its own half.
 */
export const LongTitles: Story = {
  args: {
    layout: layoutFor({
      "header-left": ["chapter"],
      "header-center": ["bookTitle"],
      "header-right": ["pages"],
      "footer-right": ["progress"],
    }),
    bookTitle: "The Annals of the Former World: A Geological History of North America",
    chapterTitle: "Assembling California, in which the geologist and the writer cross the Sierra Nevada",
  },
};

/** Only a header: a band with nothing placed in it reserves no space. */
export const HeaderOnly: Story = {
  args: { layout: layoutFor({ "header-left": ["chapter"], "header-right": ["progress"] }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Header")).toBeVisible();
    await expect(canvas.queryByLabelText("Footer")).toBeNull();
  },
};

/**
 * Before the book reports a page count or a position, the pages and progress
 * items render nothing, and the strip keeps only what it can show.
 */
export const BeforeTheBookReports: Story = {
  args: {
    layout: layoutFor({ "header-left": ["chapter"], "footer-left": ["time"], "footer-right": ["pages", "progress"] }),
    progress: undefined,
    totalPages: 0,
  },
};

/** On a dark page palette: the strips take its muted color. */
export const DarkPage: Story = {
  args: { palette: BUILTIN_READER_PALETTES.dark },
};

/**
 * The reader controls are up: the strips fade out but keep their reserved
 * height, so the page never reflows on a chrome toggle.
 */
export const Dimmed: Story = {
  args: { dimmed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Header")).toHaveStyle({ opacity: "0" });
    await expect(canvas.getByLabelText("Footer")).toHaveStyle({ opacity: "0" });
  },
};
