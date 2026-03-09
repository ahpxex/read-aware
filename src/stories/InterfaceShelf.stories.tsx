import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  NavItem,
  Eyebrow,
  Heading,
  Body,
  Caption,
  Progress,
  Badge,
  Divider,
  TextField,
  IconButton,
  DropdownMenu,
  EmptyState,
  Button,
  Stack,
} from "../components";

const navItems = ["shelf", "context", "settings"] as const;

interface Book {
  id: string;
  title: string;
  author: string;
  genre: string;
  progress?: number;
  pages: number;
  added: string;
}

const currentlyReading: Book[] = [
  { id: "1", title: "The Master and Margarita", author: "Mikhail Bulgakov", genre: "Fiction", progress: 64, pages: 412, added: "Feb 2026" },
  { id: "2", title: "Thinking, Fast and Slow", author: "Daniel Kahneman", genre: "Psychology", progress: 23, pages: 499, added: "Jan 2026" },
];

const upNext: Book[] = [
  { id: "3", title: "Austerlitz", author: "W. G. Sebald", genre: "Fiction", pages: 298, added: "Mar 2026" },
  { id: "4", title: "The Structure of Scientific Revolutions", author: "Thomas S. Kuhn", genre: "Science", pages: 210, added: "Mar 2026" },
  { id: "5", title: "Invisible Cities", author: "Italo Calvino", genre: "Fiction", pages: 165, added: "Feb 2026" },
];

function BookRow({ book }: { book: Book }) {
  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <Heading as="h3" size="xl">{book.title}</Heading>
            <Badge variant="muted">{book.genre}</Badge>
          </div>
          <Body className="mt-1 text-stone-600">{book.author}</Body>
          {book.progress !== undefined && (
            <div className="mt-3 max-w-xs">
              <Progress value={book.progress} size="sm" showValue />
            </div>
          )}
        </div>
        <Caption className="shrink-0 text-stone-600">{book.pages} pp &middot; {book.added}</Caption>
      </div>
    </div>
  );
}

function ShelfScreen() {
  const [search, setSearch] = useState("");

  return (
    <main className="min-h-screen bg-stone-100 text-stone-950">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-6 sm:px-10 sm:py-8 lg:px-14">
        <header className="border-b border-border pb-4">
          <nav aria-label="Primary" className="flex flex-wrap gap-6 sm:gap-8">
            {navItems.map((item) => (
              <NavItem key={item} active={item === "shelf"}>{item}</NavItem>
            ))}
          </nav>
        </header>

        <div className="py-8">
          <Stack direction="horizontal" gap="md" className="items-end justify-between">
            <div className="max-w-sm flex-1">
              <TextField
                label="Search"
                placeholder="Filter by title or author..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Stack direction="horizontal" gap="sm">
              <DropdownMenu
                trigger={<IconButton icon={<SortIcon />} label="Sort" />}
                items={[
                  { label: "Recently added", onClick: () => {} },
                  { label: "Title A-Z", onClick: () => {} },
                  { label: "Author A-Z", onClick: () => {} },
                ]}
              />
            </Stack>
          </Stack>
        </div>

        <section className="mt-4">
          <Eyebrow>Currently Reading</Eyebrow>
          <div className="mt-4">
            {currentlyReading.map((book, i) => (
              <div key={book.id}>
                <BookRow book={book} />
                {i < currentlyReading.length - 1 && <Divider />}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16">
          <Eyebrow>Up Next</Eyebrow>
          <div className="mt-4">
            {upNext.map((book, i) => (
              <div key={book.id}>
                <BookRow book={book} />
                {i < upNext.length - 1 && <Divider />}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function EmptyShelf() {
  return (
    <main className="min-h-screen bg-stone-100 text-stone-950">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-6 sm:px-10 sm:py-8 lg:px-14">
        <header className="border-b border-border pb-4">
          <nav aria-label="Primary" className="flex flex-wrap gap-6 sm:gap-8">
            {navItems.map((item) => (
              <NavItem key={item} active={item === "shelf"}>{item}</NavItem>
            ))}
          </nav>
        </header>

        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="Nothing on the shelf yet"
            description="Add your first book to start building your reading collection."
            action={<Button>Add a book</Button>}
          />
        </div>
      </div>
    </main>
  );
}

function SortIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 4h12M4 8h8M6 12h4" />
    </svg>
  );
}

const meta: Meta = {
  title: "Interface/Shelf",
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <ShelfScreen />,
};

export const Empty: Story = {
  render: () => <EmptyShelf />,
};
