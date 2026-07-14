import type { Meta, StoryObj } from "@storybook/react-vite";
import { NoteEditor } from "./NoteEditor";

const selectedText =
  "Every action you take is a vote for the type of person you wish to become. No single instance will transform your beliefs, but as the votes build up, so does the evidence of your new identity.";

const meta = {
  title: "Interface/Annotations/NoteEditor",
  component: NoteEditor,
  // The editor is a fixed inset-0 overlay; it escapes any decorator frame.
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    selectedText,
    onSave: () => {},
    onCancel: () => {},
  },
} satisfies Meta<typeof NoteEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** New note over a selected passage: empty body, save disabled until typed. */
export const NewNote: Story = {};

/** Editing an existing note: prefilled body plus the delete affordance. */
export const EditingNote: Story = {
  args: {
    initialContent:
      "Identity-based habits — tie this back to the introduction's outcome/process/identity layers.",
    isEditing: true,
    onDelete: () => {},
  },
};
