import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { seed, withAtoms } from "../../../story-support/atoms";
import { CURATED_FONTS } from "../lib/curated-fonts";
import { toCuratedFont, toUserFont, type ReaderFontFamily } from "../lib/reader-settings";
import { userFontsAtom } from "../lib/user-fonts";
import type { UserFontEntry } from "../../../domain/fonts";
import { FontList } from "./FontList";

/** Typed against the non-nullable branch of the props union (see FontField.stories). */
type FontListArgs = {
  value: ReaderFontFamily;
  onChange: (value: ReaderFontFamily) => void;
  className?: string;
};

/**
 * The font choices as a list, for a page of its own (the phone's appearance
 * drawer): the current font checked, in three sections — curated and plugin
 * fonts, imported files, then the fonts installed on this device.
 */
const meta = {
  title: "Interface/Settings/FontList",
  component: FontList as (props: FontListArgs) => ReturnType<typeof FontList>,
  args: { value: toCuratedFont(CURATED_FONTS[2]!.id), onChange: () => {} },
  render: (args) => <ControlledFontList {...args} />,
} satisfies Meta<FontListArgs>;

function ControlledFontList(args: FontListArgs) {
  const [value, setValue] = useState(args.value);
  return (
    <div className="w-[358px]">
      <FontList {...args} value={value} onChange={setValue} />
    </div>
  );
}

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

const sampleUserFonts: UserFontEntry[] = [
  {
    id: "a".repeat(64),
    name: "Alegreya Sans",
    format: "ttf",
    fileName: "AlegreyaSans-Regular.ttf",
    mimeType: "font/ttf",
    byteSize: 482_048,
    sha256: "a".repeat(64),
    blobKey: `userfont:${"a".repeat(64)}`,
    weight: 400,
    italic: false,
    createdAt: "2025-01-01T00:00:00Z",
    bytesLocal: true,
  },
  {
    id: "b".repeat(64),
    name: "Source Han Serif SC",
    format: "otf",
    fileName: "SourceHanSerifSC.otf",
    mimeType: "font/otf",
    byteSize: 24_180_736,
    sha256: "b".repeat(64),
    blobKey: `userfont:${"b".repeat(64)}`,
    weight: 400,
    italic: false,
    createdAt: "2025-01-02T00:00:00Z",
    bytesLocal: false,
  },
];

/** Imported files under their own section header, deletable inline; the
 *  installed section follows (the device enumeration is empty in Storybook). */
export const ImportedFonts: Story = {
  args: { value: toUserFont("a".repeat(64)) },
  decorators: [withAtoms(seed(userFontsAtom, sampleUserFonts))],
};
