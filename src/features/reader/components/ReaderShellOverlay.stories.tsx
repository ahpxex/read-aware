import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReaderShellOverlay } from "./ReaderShellOverlay";

const meta = {
  title: "Features/Reader/ReaderShellOverlay",
  component: ReaderShellOverlay,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ReaderShellOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

function ReaderShellDemo() {
  const [visible, setVisible] = useState(false);

  return (
    <div
      className="relative h-screen w-full cursor-pointer select-none bg-paper"
      onClick={() => setVisible((v) => !v)}
    >
      {/* Fake reader content */}
      <div className="mx-auto max-w-2xl px-8 py-20 font-serif text-base leading-body text-stone-800">
        <h2 className="mb-8 text-2xl font-medium text-stone-950">
          Chapter 3: How to Build Better Habits in 4 Simple Steps
        </h2>
        <p className="mb-6">
          In 1898, a psychologist named Edward Thorndike conducted an experiment
          that would lay the foundation for our understanding of how habits form
          and the rules that guide our behavior. Thorndike was interested in
          studying animal behavior, so he started working with cats.
        </p>
        <p className="mb-6">
          He would place each cat inside a device known as a puzzle box. The box
          was designed so that the cat could escape through a door by pressing a
          lever or pulling a loop of string. Thorndike would then place a piece
          of fish outside the box to create a reward.
        </p>
        <p className="mb-6">
          At first, the animals moved around the box at random, scratching and
          clawing at the walls. After a while, they would stumble upon the lever,
          the door would open, and they would eat the fish. Thorndike tracked how
          long it took for each cat to find the lever across many trials.
        </p>
        <p className="mb-6">
          In the beginning, the cats took a long time to escape. They moved
          slowly, made many errors, and seemed to figure things out by pure luck.
          However, as the experiments continued, each cat learned to associate the
          action of pressing the lever with the reward of escaping the box and
          getting a piece of fish.
        </p>
        <p className="text-stone-400">
          Click anywhere to toggle the reader shell overlay.
        </p>
      </div>

      <ReaderShellOverlay
        visible={visible}
        onBack={() => {}}
        title="Atomic Habits"
        subtitle="Chapter 3: How to Build Better Habits in 4 Simple Steps"
        progress={0.34}
        currentPosition="Page 42 of 124"
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <ReaderShellDemo />,
};
