import type { Meta, StoryObj } from "@storybook/react";
import { Shelf } from "./Shelf";
import type { Book } from "./BookCover";

const currentlyReading: Book[] = [
  { id: "1", title: "The Master and Margarita", author: "Mikhail Bulgakov", progress: 64 },
  { id: "2", title: "Thinking, Fast and Slow", author: "Daniel Kahneman", progress: 23 },
];

const upNext: Book[] = [
  { id: "3", title: "Austerlitz", author: "W. G. Sebald" },
  { id: "4", title: "The Structure of Scientific Revolutions", author: "Thomas S. Kuhn" },
  { id: "5", title: "Invisible Cities", author: "Italo Calvino" },
  { id: "6", title: "The Periodic Table", author: "Primo Levi" },
  { id: "7", title: "Pale Fire", author: "Vladimir Nabokov" },
];

const finished: Book[] = [
  { id: "8", title: "Blindness", author: "Jose Saramago", progress: 100 },
  { id: "9", title: "If on a Winter's Night a Traveler", author: "Italo Calvino", progress: 100 },
  { id: "10", title: "The Plague", author: "Albert Camus", progress: 100 },
];

const meta: Meta<typeof Shelf> = {
  title: "Features/Shelf",
  component: Shelf,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof Shelf>;

export const Default: Story = {
  args: {
    sections: [
      { label: "Currently Reading", books: currentlyReading },
      { label: "Up Next", books: upNext },
      { label: "Finished", books: finished },
    ],
  },
};

export const SingleSection: Story = {
  args: {
    sections: [
      { label: "All Books", books: [...currentlyReading, ...upNext, ...finished] },
    ],
  },
};
