import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@read-aware/ui";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { stepZoomFactor } from "../lib/fixed-layout-zoom";
import { createZoomFeedback } from "../lib/zoom-feedback";
import { ReaderZoomIndicator } from "./ReaderZoomIndicator";

type PreviewProps = {
  /** The zoom the page opens at, as a factor over its fit (1 = 100%). */
  factor: number;
  /** The reader controls are showing. */
  controlsVisible: boolean;
  /** The view starts locked. */
  locked: boolean;
};

/**
 * The indicator over a stand-in fixed-layout page, wired the way the reader
 * wires it: a zoom feedback channel the page reports to, a lock the indicator
 * toggles, and a reset that returns the zoom to the fit. The buttons below
 * the page step the zoom the way the zoom keys do.
 */
function ZoomIndicatorPreview({ factor, controlsVisible, locked: initiallyLocked }: PreviewProps) {
  const [feedback] = useState(createZoomFeedback);
  const [zoom, setZoom] = useState(factor);
  const [locked, setLocked] = useState(initiallyLocked);
  // Every zoom change is announced on the channel, as a pinch or key step is.
  useEffect(() => {
    feedback.publish(zoom);
  }, [feedback, zoom]);
  return (
    <div className="flex flex-col gap-3">
      {/* The indicator sits absolutely over the bottom of the reader canvas;
          the frame is its positioned ancestor. */}
      <div className="relative h-[26rem] overflow-hidden rounded-surface border border-border bg-fill">
        <div className="mx-auto mt-6 aspect-[3/4] h-[calc(100%-3rem)] bg-white shadow-sm" />
        <ReaderZoomIndicator
          feedback={feedback}
          controlsVisible={controlsVisible}
          locked={locked}
          onToggleLock={() => setLocked((value) => !value)}
          onReset={() => setZoom(1)}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => setZoom((value) => stepZoomFactor(value, -1))}>
          Zoom out
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setZoom((value) => stepZoomFactor(value, 1))}>
          Zoom in
        </Button>
      </div>
    </div>
  );
}

/**
 * The zoom readout of a fixed-layout page (PDF, comics). It comes up briefly
 * whenever the zoom changes; while the reader controls are up and the page is
 * zoomed off its fit, or its view is locked, it stays up with a lock that
 * holds the view still across the reading and a one-click reset to the fit.
 *
 * Each story mounts its own feedback channel; a change to the `factor`
 * control remounts the preview at that zoom.
 */
const meta = {
  title: "Interface/Reader/ReaderZoomIndicator",
  component: ZoomIndicatorPreview,
  parameters: { layout: "padded" },
  args: { factor: 1.5, controlsVisible: true, locked: false },
  argTypes: { factor: { control: { type: "number", min: 0.5, max: 6, step: 0.05 } } },
  render: (args) => <ZoomIndicatorPreview key={args.factor} {...args} />,
} satisfies Meta<typeof ZoomIndicatorPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Zoomed with the controls up: the readout stays, offering the lock and the reset. */
export const Zoomed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("150%")).toBeVisible());
    await expect(canvas.getByRole("button", { name: "Lock the zoomed view" })).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByRole("button", { name: "Reset zoom to fit" })).toBeVisible();
  },
};

/** Locking the view flips the lock's icon, label and pressed state. */
export const LockTheView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Lock the zoomed view" }));
    await expect(await canvas.findByRole("button", { name: "Unlock the view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
};

/** A locked zoomed view: reading on keeps this zoom and this column. */
export const Locked: Story = {
  args: { factor: 2, locked: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("200%")).toBeVisible());
    await expect(canvas.getByRole("button", { name: "Unlock the view" })).toHaveAttribute("aria-pressed", "true");
  },
};

/**
 * Locked at the fit: nothing to reset, but the lock stays up with the
 * controls so the view can be unlocked.
 */
export const LockedAtFit: Story = {
  args: { factor: 1, locked: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("100%")).toBeVisible());
    await expect(canvas.getByRole("button", { name: "Unlock the view" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Reset zoom to fit" })).toBeNull();
  },
};

/**
 * The reset returns the zoom to 100%; with nothing left to reset and no lock,
 * the readout goes once the zoom has held still.
 */
export const ResetToFit: Story = {
  args: { factor: 1.25 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Reset zoom to fit" }));
    await waitFor(() => expect(canvas.getByText("100%")).toBeVisible());
    await waitFor(() => expect(canvas.queryByText("100%")).toBeNull(), { timeout: 3000 });
  },
};

/**
 * Reading with the controls hidden: a zoom change shows the percentage for a
 * moment and then gets out of the way. Use "Zoom in" to bring it back.
 */
export const WhileZooming: Story = {
  args: { factor: 1.25, controlsVisible: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.queryByText("125%")).toBeNull(), { timeout: 3000 });
    await userEvent.click(canvas.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(canvas.getByText("150%")).toBeVisible());
    await waitFor(() => expect(canvas.queryByText("150%")).toBeNull(), { timeout: 3000 });
  },
};
