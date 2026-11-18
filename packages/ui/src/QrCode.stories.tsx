import type { Meta, StoryObj } from "@storybook/react-vite";
import { QrCode } from "./QrCode";

/**
 * A link a phone can pick up from the screen.
 *
 * The code is redrawn rather than embedded as someone else's image, so it
 * wears the same ink, ground and corners as the surface it sits on. It stays
 * dark-on-light in the dark theme, because that is what scanners read.
 */
const meta: Meta<typeof QrCode> = {
  title: "Design System/Components/QrCode",
  component: QrCode,
  parameters: { layout: "centered" },
  args: {
    value: "https://readaware.app",
    label: "Open readaware.app",
  },
};

export default meta;
type Story = StoryObj<typeof QrCode>;

export const Default: Story = {};

/** A long link raises the module count; the tile keeps its size, so the modules shrink. */
export const LongLink: Story = {
  args: {
    value: "https://readaware.app/docs/getting-started?utm_source=app&utm_medium=dialog&utm_campaign=whats-new",
    label: "Open the getting started guide",
    size: 160,
  },
};

/** Beside the sentence that says what scanning does — the usual placement. */
export const WithCaption: Story = {
  render: (args) => (
    <div className="flex max-w-sm items-center gap-4">
      <QrCode {...args} size={112} />
      <div>
        <p className="font-sans text-sm font-medium text-fg">Continue on your phone</p>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">Scan with your camera to open the site.</p>
      </div>
    </div>
  ),
};
