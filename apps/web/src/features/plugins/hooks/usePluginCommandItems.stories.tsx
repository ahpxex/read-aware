import type { Meta, StoryObj } from "@storybook/react-vite";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { CommandItem } from "../../command/lib/build-commands";
import type { RegisteredHeaderAction } from "../lib/plugin-types";
import { headerActionsAtom, pluginCommandsAtom } from "../state/plugin-store";
import { usePluginCommandItems } from "./usePluginCommandItems";

const headerActions: RegisteredHeaderAction[] = [
  {
    id: "notebook",
    title: "Vocabulary notebook",
    icon: "notebook",
    surface: "shelf",
    presentation: "page",
    key: "vocab:notebook",
    pluginId: "vocab",
    pluginName: "Vocabulary",
    view: () => ({ kind: "detail", content: [] }),
  },
  {
    id: "feeds",
    title: "Feeds",
    icon: "rows",
    surface: "shelf",
    presentation: "popup",
    key: "rss:feeds",
    pluginId: "rss",
    pluginName: "RSS Reader",
    view: () => ({ kind: "detail", content: [] }),
  },
  {
    // Reader-surface actions need an open book, so they must NOT appear here.
    id: "aloud",
    title: "Read aloud",
    icon: "speaker",
    surface: "reader",
    presentation: "popup",
    key: "tts:aloud",
    pluginId: "tts",
    pluginName: "Text to speech",
    view: () => ({ kind: "detail", content: [] }),
  },
];

const commands = [
  {
    id: "sync-now",
    title: "Refresh all feeds",
    icon: "arrows-clockwise",
    keywords: "rss refresh update",
    key: "rss:sync-now",
    pluginId: "rss",
    pluginName: "RSS Reader",
    run: () => undefined,
  },
  {
    id: "review",
    title: "Start a vocabulary review",
    icon: "graduation-cap",
    key: "vocab:review",
    pluginId: "vocab",
    pluginName: "Vocabulary",
    run: () => undefined,
  },
] as never;

/**
 * Plugin contributions as command-palette entries — the unconditional fallback
 * door to every installed action, no matter how the user has arranged their
 * menus.
 *
 * The rule worth seeing here is what is left *out*: reader-surface actions need
 * an open book, so they never reach the global palette. These stories render
 * the hook's output as a table, since the palette itself has its own stories.
 */
const meta = {
  title: "Interface/Plugins/PluginCommandItems",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function ItemTable() {
  const items: CommandItem[] = usePluginCommandItems(() => {});
  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-3 text-xs text-fg-subtle">{items.length} contributed commands</p>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">No plugin contributes a command.</p>
      ) : (
        <div className="flex flex-col">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 border-t border-border py-2 first:border-t-0"
            >
              <span className="w-4 shrink-0 text-fg-muted">{item.icon}</span>
              <span className="min-w-0 flex-1 text-sm text-fg">{item.title}</span>
              <span className="text-xs text-fg-muted">{item.subtitle}</span>
              <code className="w-24 text-right text-[10px] text-fg-subtle">{item.id}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Explicit plugin commands plus shelf header actions — reader ones excluded. */
export const CommandsAndShelfActions: Story = {
  render: () => <ItemTable />,
  decorators: [
    withAtoms(
      seed(pluginCommandsAtom, commands),
      seed(headerActionsAtom, headerActions),
    ),
  ],
};

/** Only declared commands, with no header actions registered. */
export const CommandsOnly: Story = {
  render: () => <ItemTable />,
  decorators: [
    withAtoms(seed(pluginCommandsAtom, commands), seed(headerActionsAtom, [])),
  ],
};

/**
 * Only reader-surface actions exist. Every one is filtered out, so the palette
 * gains nothing — the rule this hook exists to enforce.
 */
export const ReaderActionsAreExcluded: Story = {
  render: () => <ItemTable />,
  decorators: [
    withAtoms(
      seed(pluginCommandsAtom, [] as never),
      seed(headerActionsAtom, headerActions.filter((a) => a.surface === "reader")),
    ),
  ],
};

/** No plugins installed. */
export const NoPlugins: Story = {
  render: () => <ItemTable />,
  decorators: [
    withAtoms(seed(pluginCommandsAtom, [] as never), seed(headerActionsAtom, [])),
  ],
};
