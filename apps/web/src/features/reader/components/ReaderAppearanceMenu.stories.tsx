import type { Meta, StoryObj } from "@storybook/react-vite";
import { readerOverridesAtom, readerPreferencesAtom } from "../../../state/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import { DEFAULT_READER_PREFERENCES } from "../../settings/lib/reader-settings";
import type { ReaderSettingsPreferences } from "../../settings/lib/reader-settings";
import { ReaderAppearanceMenu } from "./ReaderAppearanceMenu";

const BOOK_ID = "book-pale-fire";

/** Global preferences, plus a per-book override when the story needs one. */
function appearance(
  global: Partial<ReaderSettingsPreferences> = {},
  bookOverride?: { scope: "global" | "book"; settings?: Partial<ReaderSettingsPreferences> },
) {
  const prefs = { ...DEFAULT_READER_PREFERENCES, ...global };
  return withAtoms(
    seed(readerPreferencesAtom, prefs),
    seed(
      readerOverridesAtom,
      bookOverride
        ? {
            [BOOK_ID]: {
              scope: bookOverride.scope,
              settings: { ...prefs, ...(bookOverride.settings ?? {}) },
            },
          }
        : {},
    ),
  );
}

/**
 * The in-reader appearance controls.
 *
 * The "Apply to" toggle at the top decides where edits land — the shared global
 * preferences, or this book alone — and every control below binds to whichever
 * scope is active. Both live in atoms, so the stories seed them rather than
 * depending on what this Storybook origin's localStorage happens to hold.
 *
 * Fixed-layout books (PDFs, comics) hide the typography controls entirely:
 * their pages are pictures of a page the publisher already set.
 */
const meta = {
  title: "Interface/Reader/ReaderAppearanceMenu",
  component: ReaderAppearanceMenu,
  parameters: { layout: "centered" },
  args: { bookId: BOOK_ID, open: true, onOpenChange: () => {} },
  decorators: [appearance()],
} satisfies Meta<typeof ReaderAppearanceMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Global scope on defaults: the full control set for a reflowable book. */
export const GlobalScope: Story = {};

/** Book scope: the same controls, now writing only this book's override. */
export const BookScope: Story = {
  decorators: [appearance({}, { scope: "book", settings: { fontSize: "large", theme: "dark" } })],
};

/**
 * A fixed-layout book. Typography is meaningless against a rendered page, so
 * only the page-color and reading-mode controls remain.
 */
export const FixedLayout: Story = {
  args: { fixedLayout: true },
};

/** A dark reading theme, to check the controls against an inverted palette. */
export const DarkTheme: Story = {
  decorators: [appearance({ theme: "dark" })],
};

/** `auto` follows the app theme rather than pinning a page colour. */
export const AutoTheme: Story = {
  decorators: [appearance({ theme: "auto" })],
};

/** Settings pushed away from every default, so no control reads as unset. */
export const NonDefaultSettings: Story = {
  decorators: [
    appearance({
      fontFamily: "curated:literata",
      fontSize: "xx-large",
      fontWeight: "medium",
      lineSpacing: "relaxed",
      paragraphSpacing: "loose",
      pageMargins: "narrow",
      textAlign: "justify",
      readingMode: "scroll",
    }),
  ],
};

/** Continuous scroll, where the page-turn-only options don't apply. */
export const ScrollingMode: Story = {
  decorators: [appearance({ readingMode: "scroll" })],
};

/**
 * A book whose override exists but is parked in global scope — the snapshot is
 * kept so switching back to book scope restores these choices rather than
 * re-seeding from the globals.
 */
export const ParkedBookOverride: Story = {
  decorators: [appearance({}, { scope: "global", settings: { fontSize: "small" } })],
};
