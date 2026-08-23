import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DictionaryEntrySnapshot } from "@read-aware/core";
import { Stack } from "@read-aware/ui";
import { DictionaryEntryBody, DictionaryEntryHeading } from "./DictionaryEntryBody";

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
  ],
  contextualMeaning:
    "Here the bird is the poem's opening image — the speaker identifies with its *reflection*, not the bird itself.",
  etymology: "From _wax_ + _wing_, first recorded in the 1810s.",
};

/**
 * The shared rendering of a dictionary entry — used by the reader's own lookup
 * and by every plugin surface that shows one, so its shape is a contract.
 *
 * The prose carries inline `*emphasis*` from the model; rendering it as
 * markup rather than leaking asterisks on screen is this component's job, so
 * several stories exercise that path deliberately.
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
type HeadingStory = StoryObj<typeof DictionaryEntryHeading>;

/** A full entry: two senses, examples, contextual meaning, etymology. */
export const Full: Story = {};

/** The minimum an entry can be — one sense, nothing else. */
export const SingleSense: Story = {
  args: {
    entry: {
      headword: "iridule",
      senses: [
        { partOfSpeech: "noun", definition: "An iridescent cloudlet.", examples: [] },
      ],
    },
  },
};

/** Senses with no part of speech: the italic label is dropped, not left blank. */
export const WithoutPartOfSpeech: Story = {
  args: {
    entry: {
      headword: "stillicide",
      senses: [
        { partOfSpeech: "", definition: "A falling of drops of water.", examples: [] },
      ],
    },
  },
};

/** Contextual meaning only — a lookup made from inside a passage. */
export const ContextualOnly: Story = {
  args: {
    entry: {
      headword: "shade",
      senses: [
        { partOfSpeech: "noun", definition: "Comparative darkness.", examples: [] },
      ],
      contextualMeaning: "In this line, the poet's surname — and a ghost.",
    },
  },
};

/** Etymology only, with the underscore emphasis the model tends to produce. */
export const EtymologyOnly: Story = {
  args: {
    entry: {
      headword: "preterist",
      senses: [
        { partOfSpeech: "noun", definition: "One whose chief interest is the past.", examples: [] },
      ],
      etymology: "From Latin _praeteritus_, past participle of _praeterire_ ('to go past').",
    },
  },
};

/**
 * Inline emphasis in every form the renderer accepts — `**bold**`, `*italic*`
 * and `_italic_` — including a stray unmatched asterisk, which must survive as
 * a literal rather than swallowing the rest of the line.
 */
export const InlineEmphasis: Story = {
  args: {
    entry: {
      headword: "emphasis",
      senses: [
        {
          partOfSpeech: "noun",
          definition:
            "**Bold**, *italic star*, _italic underscore_, and a lone * asterisk that stays put.",
          examples: ["An example with **bold** and _italics_ too."],
        },
      ],
      etymology: "Mixed *emphasis* in **etymology** as well.",
    },
  },
};

/** Many senses, the long tail of a common word. */
export const ManySenses: Story = {
  args: {
    entry: {
      headword: "set",
      senses: Array.from({ length: 8 }, (_, i) => ({
        partOfSpeech: i % 2 === 0 ? "verb" : "noun",
        definition: `Sense number ${i + 1}, stated at the length a real dictionary would use for it.`,
        examples: i % 3 === 0 ? [`An example sentence for sense ${i + 1}.`] : [],
      })),
    },
  },
};

/** The heading on its own: headword with pronunciation. */
export const Heading: HeadingStory = {
  render: (args) => <DictionaryEntryHeading {...args} />,
  args: { headword: "waxwing", pronunciation: "/ˈwakswɪŋ/" },
};

/** A headword with no pronunciation available. */
export const HeadingWithoutPronunciation: HeadingStory = {
  render: (args) => <DictionaryEntryHeading {...args} />,
  args: { headword: "iridule" },
};

/** Heading and body together, as every consuming surface composes them. */
export const HeadingWithBody: Story = {
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
