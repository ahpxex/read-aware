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
    // Placeholder only — FramedNavigatorBar substitutes its live ref.
    containerRef: { current: null },
    canReturn: true,
    tapToAdvance: true,
    unitId: "line",
    onUnitChange: () => {},
    onOpenPanel: () => {},
    onPrev: () => {},
    onNext: () => {},
    onReturnToCurrent: () => {},
    onExit: () => {},
    readAloudAvailable: true,
    readAloudPlaying: false,
    onToggleReadAloud: () => {},
    progress: { ordinal: 11, total: 87 },
    showProgress: true,
    sessionTimer: false,
  },
  render: (args) => <FramedNavigatorBar {...args} />,
} satisfies Meta<typeof TextUnitNavigatorBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The pure navigation strip — unit actions live in the tap menu on the wash. */
export const OnUnit: Story = {};

/** Nothing to return to yet: the return-to-current control is disabled. */
export const NoRestingUnit: Story = {
  args: { canReturn: false },
};

/** Alternate plugin unit engaged: the quick toggle shows its pressed state. */
export const AlternateUnit: Story = {
  args: { unitId: "stanza" },
};

/** Session timer running alongside the section-position readout. */
export const WithSessionTimer: Story = {
  args: { sessionTimer: true },
};

/** Both readouts off: the strip reverts to pure navigation. */
export const NoReadouts: Story = {
  args: { showProgress: false, sessionTimer: false },
};
