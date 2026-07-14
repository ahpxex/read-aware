import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChatBookReference, ChatWordReference } from "../../lib/chat-types";
import { ReferenceStack } from "./ReferenceStack";

// In Storybook there is no shelf to hydrate from, so book cards render their
// persisted snapshots (placeholder covers) — exactly the deleted-book fallback.
const BOOKS: ChatBookReference[] = [
  { bookId: "b1", title: "Debt: The First 5000 Years", author: "David Graeber" },
  { bookId: "b2", title: "Sapiens", author: "Yuval Noah Harari" },
  { bookId: "b3", title: "The Dawn of Everything", author: "Graeber & Wengrow" },
  { bookId: "b4", title: "Seeing Like a State", author: "James C. Scott" },
  { bookId: "b5", title: "Against the Grain", author: "James C. Scott" },
  { bookId: "b6", title: "The Great Transformation", author: "Karl Polanyi" },
  { bookId: "b7", title: "Bullshit Jobs", author: "David Graeber" },
];

const RICH_WORD: ChatWordReference = {
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
    etymology:
      "Coined by Horace Walpole in 1754 after 'The Three Princes of Serendip', whose heroes kept making discoveries by accident.",
    contextualMeaning: "Here it names the pleasant surprise of stumbling onto the right book.",
  },
};

const MINIMAL_WORD: ChatWordReference = {
  term: "ephemeral",
  language: "English",
  source: "vocabulary",
  // The synthesized shape present_words builds for pre-card vocabulary items.
  entry: {
    headword: "ephemeral",
    senses: [{ partOfSpeech: "", definition: "lasting a very short time", examples: [] }],
  },
};

const meta = {
  title: "Interface/AI/References/ReferenceStack",
  component: ReferenceStack,
  decorators: [
    (Story) => (
      <div className="max-w-sm bg-paper p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReferenceStack>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two books — renders in full, no expander. */
export const TwoBooks: Story = {
  args: { part: { type: "reference", id: "r1", reference: { kind: "books", books: BOOKS.slice(0, 2) } } },
};

/** Seven books — collapses to three behind the quiet expander. */
export const SevenBooksCollapsed: Story = {
  args: { part: { type: "reference", id: "r2", reference: { kind: "books", books: BOOKS } } },
};

/** A mixed word stack: a rich lookup entry plus a minimal legacy vocabulary entry. */
export const Words: Story = {
  args: {
    part: {
      type: "reference",
      id: "r3",
      reference: { kind: "words", words: [RICH_WORD, MINIMAL_WORD] },
    },
  },
};
