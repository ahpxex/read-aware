import type { Meta, StoryObj } from "@storybook/react-vite";
import { WordReferenceCard } from "./WordReferenceCard";

const meta = {
  title: "Features/AI/WordReferenceCard",
  component: WordReferenceCard,
  decorators: [
    (Story) => (
      <div className="max-w-sm bg-paper p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WordReferenceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A full live-lookup entry: pronunciation, two senses, context, etymology. */
export const RichLookup: Story = {
  args: {
    reference: {
      term: "serendipity",
      language: "English",
      source: "lookup",
      entry: {
        headword: "serendipity",
        pronunciation: "/ˌsɛɹ.ənˈdɪp.ɪ.ti/",
        senses: [
          {
            partOfSpeech: "noun",
            definition:
              "The faculty of making fortunate discoveries by accident; a happy, unplanned finding.",
            examples: ["Meeting her at the library was pure serendipity."],
          },
          { partOfSpeech: "noun", definition: "An instance of such a discovery.", examples: [] },
        ],
        etymology: "Coined by Horace Walpole in 1754 after 'The Three Princes of Serendip'.",
        contextualMeaning:
          "Here it names the pleasant surprise of stumbling onto the right book.",
      },
    },
  },
};

/** The minimal synthesized entry (vocabulary items saved before cards existed). */
export const MinimalVocabulary: Story = {
  args: {
    reference: {
      term: "ephemeral",
      language: "English",
      source: "vocabulary",
      entry: {
        headword: "ephemeral",
        senses: [{ partOfSpeech: "", definition: "lasting a very short time", examples: [] }],
      },
    },
  },
};
