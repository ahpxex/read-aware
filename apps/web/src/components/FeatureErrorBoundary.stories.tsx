import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@read-aware/ui";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { FeatureErrorBoundary } from "./FeatureErrorBoundary";

/** A stand-in surface that fails to render while `broken`. */
function StatsSurface({ broken }: { broken: boolean }) {
  if (broken) throw new Error("Story: the reading chart could not lay out its axes");
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="text-sm text-fg">Reading stats rendered.</p>
    </div>
  );
}

type BoundaryPreviewProps = {
  /** Show the controls that repair the surface or move to other content. */
  recoverable: boolean;
};

/**
 * A surface inside its boundary, framed like a workspace pane. The failure is
 * held outside the boundary, so it survives the fallback and the story can
 * repair it before "Try again", or move to other content the way a new book
 * id or nav key resets the boundary.
 */
function BoundaryPreview({ recoverable }: BoundaryPreviewProps) {
  const [broken, setBroken] = useState(true);
  const [content, setContent] = useState("stats");
  return (
    <div className="flex flex-col gap-3">
      <div className="h-[24rem] overflow-hidden rounded-lg border border-border">
        <FeatureErrorBoundary surface="stats" resetKey={content}>
          <StatsSurface broken={broken} />
        </FeatureErrorBoundary>
      </div>
      {recoverable && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setBroken(false)}>
            Repair the surface
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setBroken(false);
              setContent((key) => `${key}-next`);
            }}
          >
            Navigate to other content
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The per-surface error boundary around the reader, context, stats and
 * plugin pages: a render crash is logged and contained, the rest of the app
 * keeps running, and the surface offers a local retry and a way to copy the
 * technical detail without showing it.
 *
 * The surface here throws on purpose, so each story logs that error to the
 * console (React's report and the boundary's own log line); that is expected.
 */
const meta = {
  title: "Interface/App/FeatureErrorBoundary",
  component: BoundaryPreview,
  parameters: { layout: "padded" },
  args: { recoverable: false },
} satisfies Meta<typeof BoundaryPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The fallback a crashed surface shows in place of its content. */
export const Fallback: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole("heading", { name: "This view ran into a problem" })).toBeVisible());
    await expect(canvas.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Copy details" })).toBeVisible();
  },
};

/** "Try again" re-renders the surface; once the fault is gone, the content comes back. */
export const RetryRecovers: Story = {
  args: { recoverable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { name: "This view ran into a problem" });
    await userEvent.click(canvas.getByRole("button", { name: "Repair the surface" }));
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(canvas.getByText("Reading stats rendered.")).toBeVisible());
  },
};

/** Moving to other content clears the fallback without a retry: a stale crash never replays. */
export const ClearsOnNavigation: Story = {
  args: { recoverable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { name: "This view ran into a problem" });
    await userEvent.click(canvas.getByRole("button", { name: "Navigate to other content" }));
    await waitFor(() => expect(canvas.getByText("Reading stats rendered.")).toBeVisible());
  },
};
