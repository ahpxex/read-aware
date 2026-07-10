/**
 * One reference part = one stack of cards, rendered where the assistant called
 * its present/lookup tool. Vertical list — it fits the narrow reader panel and
 * the capped Context transcript alike. Long stacks collapse to the first three
 * behind a quiet expander. Book stacks hydrate covers/progress from one shared
 * shelf load; until then (and in Storybook / browser dev, where there is no
 * shelf) cards render their persisted snapshots.
 */
import { useState, type ReactNode } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { Caption } from "@read-aware/ui";
import { useTranslation } from "../../../../i18n";
import { useReferenceBooks } from "../../hooks/useReferenceBooks";
import type {
  ChatBookReference,
  ChatReferencePart,
  ChatWordReference,
} from "../../lib/chat-types";
import { BookReferenceCard } from "./BookReferenceCard";
import { WordReferenceCard } from "./WordReferenceCard";

const COLLAPSED_COUNT = 3;

export function ReferenceStack({ part }: { part: ChatReferencePart }) {
  return part.reference.kind === "books" ? (
    <BookStack books={part.reference.books} />
  ) : (
    <WordStack words={part.reference.words} />
  );
}

function BookStack({ books }: { books: ChatBookReference[] }) {
  const hydrated = useReferenceBooks(books.map((book) => book.bookId));
  const { visible, expander } = useStackCollapse(books.length);
  return (
    <div className="flex flex-col gap-1">
      {books.slice(0, visible).map((book) => (
        <BookReferenceCard
          key={book.bookId}
          reference={book}
          book={hydrated === null ? null : hydrated.get(book.bookId)}
        />
      ))}
      {expander}
    </div>
  );
}

function WordStack({ words }: { words: ChatWordReference[] }) {
  const { visible, expander } = useStackCollapse(words.length);
  return (
    <div className="flex flex-col gap-1">
      {words.slice(0, visible).map((word) => (
        <WordReferenceCard key={`${word.language}:${word.term}`} reference={word} />
      ))}
      {expander}
    </div>
  );
}

/** Collapse only when it hides ≥2 items — "show all 4" hiding one row is noise. */
function useStackCollapse(total: number): { visible: number; expander: ReactNode } {
  const { t } = useTranslation("ai");
  const [expanded, setExpanded] = useState(false);
  const collapsible = total > COLLAPSED_COUNT + 1;
  const visible = collapsible && !expanded ? COLLAPSED_COUNT : total;
  const expander = collapsible ? (
    <button
      type="button"
      onClick={() => setExpanded((value) => !value)}
      className="flex items-center gap-1.5 self-start rounded-sm px-1 py-0.5 text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
    >
      {expanded ? (
        <CaretUp size={11} aria-hidden="true" />
      ) : (
        <CaretDown size={11} aria-hidden="true" />
      )}
      <Caption>
        {expanded
          ? t("chat.references.showFewer")
          : t("chat.references.showAll", { count: total })}
      </Caption>
    </button>
  ) : null;
  return { visible, expander };
}
