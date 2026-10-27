import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatCircle, ListBullets, Notebook, TextAa } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { readerOverridesAtom, readerPreferencesAtom } from "../../../state/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import { DEFAULT_READER_PREFERENCES, type ReaderSettingsPreferences } from "../../settings/lib/reader-settings";
import { ReaderAppearanceCompact } from "./ReaderAppearanceCompact";
import { ReaderBottomBar } from "./ReaderBottomBar";

const BOOK_ID = "book-pale-fire";

function appearance(global: Partial<ReaderSettingsPreferences> = {}, bookScope = false) {
  const prefs = { ...DEFAULT_READER_PREFERENCES, ...global };
  return withAtoms(
    seed(readerPreferencesAtom, prefs),
    seed(readerOverridesAtom, bookScope ? { [BOOK_ID]: { scope: "book", settings: prefs } } : {}),
  );
}

/** The drawer as it opens on a phone: in the bottom bar, above its icons. */
function InBottomBar({ fixedLayout = false }: { fixedLayout?: boolean }) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const icon = (label: string, node: React.ReactNode) => (
    <IconButton key={label} size="toolbar" label={label} icon={node} />
  );
  return (
    <div className="flex h-[760px] w-[390px] flex-col justify-end bg-[var(--ra-main-surface-color)]">
      <ReaderBottomBar
        visible
        slotRowRef={rowRef}
        drawerId="appearance-drawer"
        drawer="appearance"
        renderDrawer={() => ({
          title: "Reading appearance",
          body: (
            <div className="min-h-0 overflow-y-auto pb-3 pt-1">
              <ReaderAppearanceCompact bookId={BOOK_ID} fixedLayout={fixedLayout} />
            </div>
          ),
        })}
        onCloseDrawer={() => {}}
        slots={[
          icon("Contents", <ListBullets size={20} />),
          icon("Notes", <Notebook size={20} />),
          icon("Appearance", <TextAa size={20} weight="bold" />),
          icon("Chat", <ChatCircle size={20} />),
        ]}
      />
    </div>
  );
}

/**
 * The phone's appearance drawer. Text size and page color lead; each other
 * setting is one line, the font and the finer typography opening as pages
 * in place.
 */
const meta = {
  title: "Interface/Reader/ReaderAppearanceCompact",
  component: InBottomBar,
  parameters: { layout: "centered" },
  decorators: [appearance()],
} satisfies Meta<typeof InBottomBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Applying to this book only: the switch is on and says what it means. */
export const BookScope: Story = { decorators: [appearance({ theme: "dark", fontSize: "large" }, true)] };

/** A fixed-layout book: no text size or font, its own page rendering line. */
export const FixedLayout: Story = { args: { fixedLayout: true } };

/** Custom-typography mode: the layout subpage shows exact-value sliders. */
export const CustomMode: Story = {
  decorators: [
    appearance({
      typographyMode: "custom",
      customTypography: {
        fontSizePx: 18,
        lineHeight: 1.75,
        paragraphSpacingEm: 0.8,
        pageMarginPercent: 10,
        textIndentEm: 2,
      },
    }),
  ],
};
