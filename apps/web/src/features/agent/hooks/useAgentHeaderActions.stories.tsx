import type { Meta, StoryObj } from "@storybook/react-vite";
import { MenuOverflow } from "../../menus/components/MenuOverflow";
import { useAgentHeaderActions } from "./useAgentHeaderActions";

/**
 * The Agent page's header actions: new conversation and the highlights &
 * notes page. (The thread list's toggle sits at the header's start instead,
 * above the list: `ThreadsSidebarToggle`.)
 *
 * They are *atomized* rather than one cluster, which is the point of the hook:
 * each entry carries both an inline rendering and an overflow rendering, so a
 * narrowing window can collapse them one at a time into the dots menu.
 */
const meta = {
  title: "Interface/Agent/AgentHeaderActions",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness() {
  const entries = useAgentHeaderActions({
    onOpenAnnotations: () => {},
    onNewConversation: () => {},
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div>
        <span className="mb-2 block text-xs text-fg-subtle">inline</span>
        <div className="flex items-center justify-end gap-1 rounded-md border border-border bg-surface px-3 py-2">
          {entries.map((entry) => (
            <span key={entry.id}>{entry.inline}</span>
          ))}
        </div>
      </div>
      <div>
        <span className="mb-2 block text-xs text-fg-subtle">collapsed into the dots menu</span>
        <div className="flex items-center justify-end rounded-md border border-border bg-surface px-3 py-2">
          <MenuOverflow entries={entries.map((entry) => entry.overflow)} />
        </div>
      </div>
    </div>
  );
}

/** Both actions, in both renderings. */
export const InlineAndOverflow: Story = {
  render: () => <Harness />,
};
