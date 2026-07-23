import type { Meta, StoryObj } from "@storybook/react-vite";
import { Metadata } from "./Metadata";

const meta = {
  title: "Design System/Components/Metadata",
  component: Metadata,
} satisfies Meta<typeof Metadata>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <>
        <Metadata.Label title="Book" value="Frankenstein" />
        <Metadata.Label title="Added" value="Jul 24, 2026" />
        <Metadata.Separator />
        <Metadata.Tags title="Themes" values={["chance", "discovery"]} />
      </>
    ),
  },
};

export const Footer: Story = {
  args: {
    layout: "horizontal",
    children: (
      <>
        <Metadata.Label title="Book" value="Frankenstein" />
        <Metadata.Label title="Added" value="Jul 24, 2026" />
        <Metadata.Tags title="Themes" values={["chance", "discovery"]} />
      </>
    ),
  },
};
