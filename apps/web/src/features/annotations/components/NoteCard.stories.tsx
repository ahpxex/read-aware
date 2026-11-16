import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { Note } from "../lib/annotation-types";
import { NoteCard, type NoteCardProps } from "./NoteCard";

const passage =
  "Every action you take is a vote for the type of person you wish to become. No single instance will transform your beliefs, but as the votes build up, so does the evidence of your new identity.";

const note = (id: string, content: string, createdAt: string, updatedAt = createdAt): Note => ({
  id,
  bookId: "atomic-habits",
  type: "note",
  text: passage,
  content,
  cfiRange: "epubcfi(/6/14!/4/2/8,/1:0,/1:182)",
  chapterHref: "ch02.xhtml",
  createdAt,
  updatedAt,
});

const thread: Note[] = [
  note(
    "n1",
    "Identity-based habits — tie this back to the introduction's outcome/process/identity layers.",
    "2026-10-02T21:14:00.000Z",
  ),
  note(
    "n2",
    "Re-read after a month: the “vote” framing is what made the morning run stick.\nIt’s about evidence, not willpower.",
    "2026-11-03T07:42:00.000Z",
    "2026-11-03T08:10:00.000Z",
  ),
];

/** The card as the reader drives it: the draft lives outside, edits switch it. */
function Interactive(props: Partial<NoteCardProps> & { notes: Note[] }) {
  const [text, setText] = useState(props.text ?? "");
  const [editingId, setEditingId] = useState<string | null>(props.editingId ?? null);
  return (
    <div className="w-[22rem] rounded-lg border border-border bg-[var(--ra-main-surface-color)] p-3 shadow-[0_8px_28px_-10px_rgba(28,25,23,0.35)]">
      <NoteCard
        doneShortcut={["⌘", "Enter"]}
        onDelete={() => {}}
        onDone={() => {}}
        {...props}
        text={text}
        onTextChange={setText}
        editingId={editingId}
        onEdit={(next) => {
          setEditingId(next?.id ?? null);
          setText(next?.content ?? "");
        }}
      />
    </div>
  );
}

/**
 * A passage's notes, beside the passage. No title and no Save: closing the
 * card — Done, ⌘↩, Escape, a tap on the page — saves what was written; an
 * emptied note is kept (Delete deletes). Each note is dated, and the field
 * below adds another.
 */
const meta = {
  title: "Interface/Annotations/NoteCard",
  component: Interactive,
  args: { notes: [] },
} satisfies Meta<typeof Interactive>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first note on a passage: just the field, focused. */
export const FirstNote: Story = {
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole("textbox", { name: "Your note" });
    await waitFor(() => expect(field).toHaveFocus());
  },
};

/** Notes already written, each dated (one edited since); the field adds another. */
export const AddingToNotes: Story = {
  args: { notes: thread },
};

/** One note opened for editing in its place; the others stay as they are. */
export const EditingOne: Story = {
  args: { notes: thread },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const edit = canvas.getAllByRole("button", { name: "Edit note" })[0]!;
    await userEvent.click(edit);
    const field = await canvas.findByRole("textbox", { name: "Your note" });
    await waitFor(() => expect(field).toHaveValue(thread[0]!.content));
    await expect(canvas.getByRole("button", { name: "Add another note" })).toBeVisible();
  },
};

/** Saving: Done waits for the write. */
export const Saving: Story = {
  args: { notes: thread, text: "One more thought", isSaving: true },
};

/** On a phone the card is a sheet over the page, so it quotes the passage. */
export const WithPassage: Story = {
  args: { notes: thread.slice(0, 1), passage },
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
