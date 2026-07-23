import type { Meta, StoryObj } from "@storybook/react-vite";
import { Trash } from "@phosphor-icons/react";
import { Detail } from "./Detail";
import { IconButton } from "./IconButton";
import { Metadata } from "./Metadata";
import { Quote } from "./Quote";
import { Stack } from "./Stack";
import { Tooltip } from "./Tooltip";
import { Body } from "./typography/Body";
import { Heading } from "./typography/Heading";

const meta = {
  title: "Design System/Components/Detail",
  component: Detail,
} satisfies Meta<typeof Detail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    header: (
      <Stack gap="xs">
        <Heading className="font-serif">serendipity</Heading>
        <Body className="text-fg-muted">/ˌserənˈdipədē/</Body>
      </Stack>
    ),
    children: (
      <Stack gap="lg">
        <Body>a happy accident</Body>
        <Quote attribution="Frankenstein">A discovery made by chance.</Quote>
      </Stack>
    ),
    metadata: (
      <Metadata layout="horizontal">
        <Metadata.Label title="Book" value="Frankenstein" />
        <Metadata.Label title="Added" value="Jul 24, 2026" />
      </Metadata>
    ),
    actions: (
      <Tooltip content="Delete word" align="end">
        <IconButton
          label="Delete word"
          tone="danger"
          size="sm"
          icon={<Trash size={16} aria-hidden="true" />}
        />
      </Tooltip>
    ),
  },
};
