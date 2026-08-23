import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DictionaryEntrySnapshot } from "@read-aware/core";
import { Stack } from "@read-aware/ui";
import { DictionaryEntryBody, DictionaryEntryHeading } from "./DictionaryEntryBody";

/**
 * A complete entry. Every part an entry can have is present, because they are
 * not alternatives — a real lookup returns as many of them as the source knows,
 * and the layout's job is to hold all of them at once.
 *
 * The prose deliberately carries the `**bold**` / `*italic*` / `_italic_` the
 * model salts dictionary text with, plus a lone asterisk: rendering that as
 * markup rather than leaking the characters on screen is what this component
 * is for.
 */
const entry: DictionaryEntrySnapshot = {
  headword: "waxwing",
  pronunciation: "/ˈwakswɪŋ/",
  senses: [
    {
      partOfSpeech: "noun",
      definition:
        "A crested passerine bird with silky brown plumage and *waxy* red tips on the secondary wing feathers.",
      examples: [
        "I was the shadow of the waxwing slain by the false azure in the windowpane.",
      ],
    },
    {
      partOfSpeech: "noun",
      definition: "Any bird of the genus **Bombycilla**.",
      examples: [],
    },
    {
      // No part of speech: the italic label is dropped, not left blank.
      partOfSpeech: "",
      definition: "A lone * asterisk stays put rather than swallowing the line.",
      examples: [],
    },
  ],
  contextualMeaning:
    "Here the bird is the poem's opening image — the speaker identifies with its _reflection_, not the bird itself.",
  etymology: "From *wax* + *wing*, first recorded in the 1810s.",
};

/**
 * The shared rendering of a dictionary entry — used by the reader's own lookup
 * and by every plugin surface that shows one, so its shape is a contract.
 *
 * The heading and the body are separate exports because the surfaces compose
 * them differently (a detail view promotes the headword into its own title
 * bar), but they are one thing to look at, so there is one story.
 */
const meta = {
  title: "Interface/Reader/DictionaryEntryBody",
  component: DictionaryEntryBody,
  parameters: { layout: "padded" },
  args: { entry },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DictionaryEntryBody>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Heading and body together, as every consuming surface composes them. */
export const Default: Story = {
  render: (args) => (
    <Stack gap="md">
      <DictionaryEntryHeading
        headword={args.entry.headword}
        pronunciation={args.entry.pronunciation}
      />
      <DictionaryEntryBody {...args} />
    </Stack>
  ),
};
