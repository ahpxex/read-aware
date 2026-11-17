import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import {
  ChatCircleDots,
  Copy,
  Highlighter,
  ListBullets,
  NotePencil,
  SpeakerHigh,
  TextUnderline,
  X,
} from "@phosphor-icons/react";
import type { HoldMenuState } from "../hooks/useReaderHoldMenu";
import { ReaderHoldMenu } from "./ReaderHoldMenu";

const actions = [
  { id: "highlight", label: "Highlight", icon: <Highlighter size={16} aria-hidden="true" />, run: () => {} },
  { id: "underline", label: "Underline", icon: <TextUnderline size={16} aria-hidden="true" />, run: () => {} },
  { id: "note", label: "Add a note", icon: <NotePencil size={16} aria-hidden="true" />, run: () => {} },
  { id: "ask", label: "Ask AI about this", icon: <ChatCircleDots size={16} aria-hidden="true" />, run: () => {} },
  { id: "copy", label: "Copy", icon: <Copy size={16} aria-hidden="true" />, run: () => {} },
  { id: "read", label: "Read aloud", icon: <SpeakerHigh size={16} aria-hidden="true" />, run: () => {} },
];
const moreItems = [
  { label: "Table of contents", onClick: () => {}, icon: <ListBullets size={14} /> },
  { label: "Exit reading by sentence", onClick: () => {}, icon: <X size={14} /> },
];

// The menu positions itself inside its own inset-0 overlay, so the frame is
// `relative` and tall enough for the row to sit above the finger.
function Framed({ state }: { state: HoldMenuState }) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  return (
    <div className="relative h-[28rem] overflow-hidden rounded-surface border border-border bg-paper">
      <p className="p-6 font-serif text-lg leading-relaxed text-fg">
        Unlike most kids who grew up in Eichler homes, Jobs knew what they were and why they were so wonderful.
      </p>
      <ReaderHoldMenu
        state={state}
        title="Sentence reading"
        actions={actions}
        moreLabel="More actions"
        moreItems={moreItems}
        menuRef={menuRef}
        onMoreOpenChange={() => {}}
        onClose={() => {}}
      />
    </div>
  );
}

const meta = {
  title: "Interface/Reader/ReaderHoldMenu",
  component: Framed,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Framed>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The finger is still down and rests on "Underline": raised and named. */
export const Sliding: Story = {
  args: { state: { anchor: { x: 200, y: 300 }, sliding: true, hovered: 1, moreOpen: false } },
};

/** Lifted in place: the row stays and works by taps. */
export const Resting: Story = {
  args: { state: { anchor: { x: 200, y: 300 }, sliding: false, hovered: null, moreOpen: false } },
};

/** The second tier behind "more". */
export const More: Story = {
  args: { state: { anchor: { x: 200, y: 300 }, sliding: false, hovered: null, moreOpen: true } },
};
