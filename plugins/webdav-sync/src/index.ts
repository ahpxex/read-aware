/**
 * WebDAV Sync — a first-party `sync:transport` plugin.
 *
 * The host's sync engine keeps everything that matters: encryption, the
 * event log, cursors, merge. This plugin only answers "where is the remote
 * and how do we talk to it": it registers one transport whose sessions speak
 * WebDAV against the server configured in the plugin's settings. Nothing
 * here ever sees plaintext events, book bytes, or keys.
 *
 * `open()` is contractually network-free: it reads the current settings and
 * builds a session; the first actual request happens when the host probes or
 * syncs. That is what lets the host cheaply re-open per cycle and pick up
 * settings edits.
 */
import type { PluginContext, PluginModule } from "@read-aware/plugin-types";
import { createWebdavClient } from "./client";
import { readWebdavSettings, webdavEndpointId, webdavRootUrl, type StoredSettings } from "./settings";
import { createWebdavTransportSession } from "./transport";

const plugin: PluginModule = {
  activate(ctx: PluginContext) {
    const { syncTransports } = ctx.contributions;
    const network = ctx.services.network;
    if (!syncTransports || !network) {
      throw new Error("webdav-sync requires the syncTransports contribution and network service");
    }

    syncTransports.register({
      id: "webdav",
      label: "WebDAV",
      async open() {
        const settings = readWebdavSettings(ctx.services.storage.get<StoredSettings>("settings"));
        const password = (await ctx.services.secrets.get("password")) ?? "";
        const client = createWebdavClient({
          baseUrl: webdavRootUrl(settings),
          username: settings.username,
          password,
          fetchFn: (url, init) => network.fetch(url, init),
        });
        return createWebdavTransportSession({
          client,
          endpointId: webdavEndpointId(settings),
        });
      },
    });
  },
};

export default plugin;
