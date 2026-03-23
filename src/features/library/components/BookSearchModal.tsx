/**
 * Book Search Modal - Quick book finder and selector
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { IconButton, Body, Heading } from "../../../components";
import { X, MagnifyingGlass, Book } from "@phosphor-icons/react";
import { cn } from "../../../components/lib/cn";
import type { LibraryBook } from "../lib/library-types";

interface BookSearchModalProps {
  isOpen: boolean;
  books: LibraryBook[];
  onClose: () => void;
  onSelectBook: (book: LibraryBook) => void;
}

export function BookSearchModal({ isOpen, books, onClose, onSelectBook }: BookSearchModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredBooks = useMemo(() => {
    if (!query.trim()) return books;
    const lowerQuery = query.toLowerCase().trim();
    return books.filter(
      (book) =>
        book.title.toLowerCase().includes(lowerQuery) ||
        book.author.toLowerCase().includes(lowerQuery)
    );
  }, [books, query]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (filteredBooks.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredBooks.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredBooks.length) % filteredBooks.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const book = filteredBooks[selectedIndex];
        if (book) {
          onSelectBook(book);
          onClose();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredBooks, selectedIndex, onClose, onSelectBook]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-stone-950/35 backdrop-blur-sm px-4 py-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={cn(
          "flex w-full max-w-xl flex-col border border-border bg-[var(--ra-main-surface-color)]",
          "shadow-[0_12px_32px_rgba(28,25,23,0.15)]",
          "animate-in fade-in slide-in-from-top-2 duration-200"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <MagnifyingGlass size={20} weight="regular" className="text-stone-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search books by title or author..."
            className="flex-1 bg-transparent text-base text-stone-950 outline-none placeholder:text-stone-400"
          />
          <IconButton
            label="Close"
            size="sm"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600"
            icon={<X size={16} weight="regular" />}
          />
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {filteredBooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Book size={32} weight="regular" className="text-stone-300 mb-3" />
              <Body className="text-stone-500">
                {query.trim() ? `No books found for "${query}"` : "Start typing to search your library"}
              </Body>
            </div>
          ) : (
            <ul className="py-2">
              {filteredBooks.map((book, index) => (
                <li
                  key={book.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
                    index === selectedIndex
                      ? "bg-stone-100"
                      : "hover:bg-stone-50"
                  )}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    onSelectBook(book);
                    onClose();
                  }}
                >
                  {/* Book Cover Thumbnail */}
                  <div className="h-12 w-8 shrink-0 overflow-hidden rounded-sm bg-stone-200">
                    {book.coverUrl ? (
                      <img
                        src={book.coverUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Book size={16} className="text-stone-400" />
                      </div>
                    )}
                  </div>

                  {/* Book Info */}
                  <div className="min-w-0 flex-1">
                    <Heading size="xl" className="truncate text-base font-medium">
                      {book.title}
                    </Heading>
                    <Body className="truncate text-sm text-stone-500">
                      {book.author}
                      {book.progressPercent > 0 && (
                        <span className="ml-2 text-stone-400">
                          · {Math.round(book.progressPercent)}%
                        </span>
                      )}
                    </Body>
                  </div>

                  {/* Reading Status */}
                  {book.readingStatus === "reading" && (
                    <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                      Reading
                    </span>
                  )}
                  {book.readingStatus === "finished" && (
                    <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                      Finished
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-stone-400">
          <span>
            {filteredBooks.length} {filteredBooks.length === 1 ? "book" : "books"}
          </span>
          <div className="flex gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>Esc Close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
