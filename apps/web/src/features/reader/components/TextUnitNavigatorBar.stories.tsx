import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import type { ComponentProps } from "react";
import type { RegisteredReaderMode } from "../../plugins/lib/plugin-types";
import { TextUnitNavigatorBar } from "./TextUnitNavigatorBar";

const text = (value: string) => ({ default: value });
const mode: RegisteredReaderMode = {
  id: "paced-reading",
  key: "example:paced-reading",
  pluginId: "example",
  pluginName: "Paced Reader",
  kind: "text-unit-navigator",
  icon: "rows",
  units: [
    {
      id: "line",
      label: text("By line"),
      previousLabel: text("Previous line"),
      nextLabel: text("Next line"),
    },
    {
      id: "stanza",
      label: text("By stanza"),
      previousLabel: text("Previous stanza"),
      nextLabel: text("Next stanza"),
      toggleLabel: text("Stanza mode"),
      icon: "paragraph",
    },
  ],
  defaultUnitId: "line",
  copy: {
    title: text("Paced reading"),
    enable: text("Start paced reading"),
    exit: text("Exit paced reading"),
    returnToCurrent: text("Back to current line"),
    showToolbars: text("Show toolbars"),
    moreActions: text("More actions"),
    collapseActions: text("Collapse actions"),
    menuLabel: text("Paced reader"),
    settings: {
      description: text("Configure paced reading."),
      unitLabel: text("Step unit"),
      tapToAdvance: { title: text("Tap to advance"), description: text("Tap once.") },
      scrollToStep: { title: text("Swipe to step"), description: text("Swipe once.") },
    },
    shortcuts: {
      description: text("Active while paced reading is on."),
      volumeKeys: text("Step with volume keys"),
    },
  },
  segmentText: () => [],
};

// useDraggableFloat clamps drags against a live container element, so the
// frame owns the ref and overrides the placeholder ref passed through args.
function FramedNavigatorBar(props: ComponentProps<typeof TextUnitNavigatorBar>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={containerRef}
      className="relative h-[26rem] overflow-hidden rounded-lg border border-border"
    >
      <TextUnitNavigatorBar {...props} containerRef={containerRef} />
    </div>
  );
}

const meta = {
  title: "Interface/Reader/TextUnitNavigatorBar",
  component: TextUnitNavigatorBar,
  parameters: { layout: "fullscreen" },
  args: {
    visible: true,
    mode,
    targetKey: "chapter-03.xhtml#s41",
    // Placeholder only — FramedNavigatorBar substitutes its live ref.
    containerRef: { current: null },
    canReturn: true,
    tapToAdvance: true,
    unitId: "line",
    onUnitChange: () => {},
    onToggleToolbars: () => {},
    onPrev: () => {},
    onNext: () => {},
    onReturnToCurrent: () => {},
    onCopy: () => {},
    onHighlight: () => {},
    onUnderline: () => {},
    onAddNote: () => {},
    onLookUp: () => {},
    onAskAI: () => {},
    onExit: () => {},
  },
  render: (args) => <FramedNavigatorBar {...args} />,
} satisfies Meta<typeof TextUnitNavigatorBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Resting on a unit: stepping, return-to-current, and every action enabled. */
export const OnUnit: Story = {};

/** No resting unit: unit-scoped actions disabled; stepping and exit stay live. */
export const NoRestingUnit: Story = {
  args: { targetKey: null, canReturn: false },
};

/** Alternate plugin unit engaged: the quick toggle shows its pressed state. */
export const AlternateUnit: Story = {
  args: { unitId: "stanza" },
};
