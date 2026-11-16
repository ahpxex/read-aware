import { useEffect } from "react";
import { getDefaultStore, Provider } from "jotai";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PluginUriRequest, PluginViewResult } from "@read-aware/plugin-types";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { appLinkScheme } from "../../../platform/app-identity";
import { parsePluginUri, pendingPluginUrisAtom, pluginUriRegistry } from "../lib/plugin-uri";
import { pluginDialogAtom, pluginsReadyAtom } from "../state/plugin-store";
import { PluginDialogHost } from "./PluginDialogHost";
import { PluginUriPrompt } from "./PluginUriPrompt";

const PLUGIN_ID = "vocab";
const HANDLER_ID = "add-word";

/** A plugin link in this build's scheme (`readaware-dev` in development). */
function pluginLink(query: string): string {
  return `${appLinkScheme()}://plugin/${PLUGIN_ID}/${HANDLER_ID}?${query}`;
}

/** What the stand-in handler opens: the request it was handed, as a detail view. */
function openWord(request: PluginUriRequest): PluginViewResult {
  return {
    view: {
      kind: "detail",
      title: "Add to vocabulary",
      content: [{ kind: "keyValue", rows: request.parameters.map(({ key, value }) => ({ label: key, value })) }],
    },
  };
}

type ReceivedLinkProps = {
  /** The external link that arrived. */
  url: string;
  /** Whether the plugin the link names has registered its handler. */
  handlerRegistered: boolean;
};

/**
 * A plugin link received at launch, as the app holds it. The link queue,
 * the handler registry and the dismissal all live in jotai's default store
 * (`lib/plugin-uri`), as the app does with no Provider of its own, so the
 * prompt renders against that store rather than a seeded story store; this
 * mount sets the state up and tears every piece of it down. The plugin
 * dialog host is mounted beside it, as in App, so "Open" shows where the
 * link goes.
 *
 * Because it is the default store, the story does not follow the toolbar's
 * e-ink and motion toggles (they seed the per-story store only).
 */
function ReceivedLink({ url, handlerRegistered }: ReceivedLinkProps) {
  const store = getDefaultStore();
  useEffect(() => {
    const registration = handlerRegistered
      ? pluginUriRegistry.register({
          id: HANDLER_ID,
          key: `${PLUGIN_ID}:${HANDLER_ID}`,
          pluginId: PLUGIN_ID,
          pluginName: "Vocabulary",
          open: openWord,
        })
      : null;
    // Queued directly rather than through `receivePluginUris`, whose
    // five-second duplicate guard would swallow the link on a quick remount.
    const link = parsePluginUri(url);
    store.set(pluginDialogAtom, null);
    store.set(pendingPluginUrisAtom, link ? [{ ...link, id: 1 }] : []);
    store.set(pluginsReadyAtom, true);
    return () => {
      registration?.dispose();
      store.set(pendingPluginUrisAtom, []);
      store.set(pluginDialogAtom, null);
      store.set(pluginsReadyAtom, false);
    };
  }, [store, url, handlerRegistered]);
  return (
    <Provider store={store}>
      <PluginUriPrompt />
      <PluginDialogHost />
    </Provider>
  );
}

/**
 * The confirmation shown when an external link addresses a plugin. Receiving
 * a link never calls the plugin: the user sees the exact link and which
 * plugin it goes to, and only "Open" hands it over, to the handler that was
 * registered when the prompt came up.
 */
const meta = {
  title: "Interface/Plugins/PluginUriPrompt",
  component: ReceivedLink,
  parameters: { layout: "fullscreen" },
  args: { url: pluginLink("word=iridescent&lang=en"), handlerRegistered: true },
  // The prompt holds the link it showed; a control change is a new link arriving.
  render: (args) => <ReceivedLink key={`${args.url}|${String(args.handlerRegistered)}`} {...args} />,
} satisfies Meta<typeof ReceivedLink>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The plugin's handler is registered: the link can be opened. */
export const ReadyToOpen: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole("dialog", { name: "Open link in Vocabulary?" });
    await waitFor(() => expect(within(dialog).getByText(pluginLink("word=iridescent&lang=en"))).toBeVisible());
    await expect(within(dialog).getByRole("button", { name: "Open" })).toBeEnabled();
  },
};

/** Opening hands the request to the plugin, whose result shows in the plugin dialog. */
export const OpensInPlugin: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const prompt = await page.findByRole("dialog", { name: "Open link in Vocabulary?" });
    await userEvent.click(within(prompt).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(page.getByText("iridescent")).toBeVisible());
    await expect(page.queryByRole("dialog", { name: "Open link in Vocabulary?" })).toBeNull();
  },
};

/**
 * No handler registered for the link (the plugin is disabled or no longer
 * offers it): the title falls back to the plugin id, the prompt explains,
 * and "Open" stays disabled.
 */
export const HandlerUnavailable: Story = {
  args: { handlerRegistered: false },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole("dialog", { name: `Open link in ${PLUGIN_ID}?` });
    await waitFor(() => expect(within(dialog).getByText(/This plugin entry is unavailable/)).toBeVisible());
    await expect(within(dialog).getByRole("button", { name: "Open" })).toBeDisabled();
  },
};

/** Cancel dismisses the link for good: it leaves the queue and the prompt does not come back. */
export const CancelDismisses: Story = {
  args: { handlerRegistered: false },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole("dialog", { name: `Open link in ${PLUGIN_ID}?` });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(page.queryByRole("dialog")).toBeNull());
  },
};

/** A long link scrolls inside its box rather than stretching the dialog. */
export const LongLink: Story = {
  args: {
    url: pluginLink(
      Array.from(
        { length: 20 },
        (_, index) => `note${index + 1}=${encodeURIComponent("A passage worth keeping, with its context and source")}`,
      ).join("&"),
    ),
  },
};
