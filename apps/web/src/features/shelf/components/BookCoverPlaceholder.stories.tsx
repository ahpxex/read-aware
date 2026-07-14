import type { Meta, StoryObj } from "@storybook/react-vite";
import { BookCoverPlaceholder } from "./BookCoverPlaceholder";

const meta = {
  title: "Interface/Shelf/BookCoverPlaceholder",
  component: BookCoverPlaceholder,
  parameters: { layout: "centered" },
} satisfies Meta<typeof BookCoverPlaceholder>;

export default meta;
type Story = StoryObj<typeof meta>;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-40">
      <div className="aspect-[2/3] w-full overflow-hidden rounded-sm">{children}</div>
    </div>
  );
}

/** Title, author, and format badge on the deterministic spine tone. */
export const Default: Story = {
  args: { title: "The Master and Margarita", author: "Mikhail Bulgakov", format: "epub" },
  render: (args) => (
    <Frame>
      <BookCoverPlaceholder {...args} />
    </Frame>
  ),
};

/** A long title wrapping within the fixed 2:3 cover frame. */
export const LongTitle: Story = {
  args: {
    title: "The Structure of Scientific Revolutions",
    author: "Thomas S. Kuhn",
    format: "pdf",
  },
  render: (args) => (
    <Frame>
      <BookCoverPlaceholder {...args} />
    </Frame>
  ),
};

/** Title only — no author or format metadata. */
export const NoAuthor: Story = {
  args: { title: "Invisible Cities" },
  render: (args) => (
    <Frame>
      <BookCoverPlaceholder {...args} />
    </Frame>
  ),
};

/** The surface tone is derived deterministically from the title, so a shelf of
 *  cover-less books still reads as distinct spines. */
export const Gallery: Story = {
  args: { title: "Gallery" },
  parameters: { layout: "padded" },
  render: () => {
    const books: { title: string; author: string; format: "epub" | "pdf" }[] = [
      { title: "Pale Fire", author: "Vladimir Nabokov", format: "epub" },
      { title: "Austerlitz", author: "W. G. Sebald", format: "epub" },
      { title: "Blindness", author: "José Saramago", format: "pdf" },
      { title: "The Plague", author: "Albert Camus", format: "epub" },
      { title: "Invisible Cities", author: "Italo Calvino", format: "epub" },
      { title: "The Periodic Table", author: "Primo Levi", format: "pdf" },
    ];
    return (
      <div className="grid w-full max-w-3xl grid-cols-3 gap-5 sm:grid-cols-6">
        {books.map((book) => (
          <div key={book.title} className="aspect-[2/3] w-full overflow-hidden rounded-sm">
            <BookCoverPlaceholder {...book} />
          </div>
        ))}
      </div>
    );
  },
};
