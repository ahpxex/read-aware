import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "./Card";
import { Button } from "./Button";

const meta = {
  title: "Design System/Components/Card",
  component: Card,
  argTypes: {
    variant: { control: "select", options: ["flat", "outlined", "filled"] },
    padding: { control: "select", options: ["none", "sm", "md", "lg"] },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Outlined: Story = {
  args: {
    children: (
      <>
        <Card.Header>
          <p className="font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-600">
            Chapter 1
          </p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-stone-950">
            The White Album
          </h3>
        </Card.Header>
        <Card.Body>
          We tell ourselves stories in order to live. The princess is caged in
          the consulate. The man with the candy will lead the children into the
          sea.
        </Card.Body>
      </>
    ),
  },
};

export const Filled: Story = {
  args: {
    variant: "filled",
    children: (
      <>
        <Card.Header>
          <h3 className="text-lg font-semibold tracking-tight text-stone-950">
            Reading progress
          </h3>
        </Card.Header>
        <Card.Body>
          <p>3 of 12 chapters completed.</p>
        </Card.Body>
      </>
    ),
  },
};

export const WithFooter: Story = {
  args: {
    children: (
      <>
        <Card.Header>
          <h3 className="text-lg font-semibold tracking-tight text-stone-950">
            Remove from shelf?
          </h3>
        </Card.Header>
        <Card.Body>
          This will remove the item from your shelf. You can always add it back
          later.
        </Card.Body>
        <Card.Footer>
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
          <Button variant="danger" size="sm">
            Remove
          </Button>
        </Card.Footer>
      </>
    ),
  },
};

export const Flat: Story = {
  args: {
    variant: "flat",
    padding: "lg",
    children: (
      <Card.Body>
        <p>A flat card with no border, just content on paper.</p>
      </Card.Body>
    ),
  },
};

export const AsArticle: Story = {
  args: {
    as: "article",
    children: (
      <>
        <Card.Header>
          <h3 className="text-lg font-semibold tracking-tight text-stone-950">
            Semantic HTML
          </h3>
        </Card.Header>
        <Card.Body>
          This card renders as an article element.
        </Card.Body>
      </>
    ),
  },
};
