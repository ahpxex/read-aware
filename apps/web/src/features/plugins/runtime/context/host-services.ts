import { bookServiceStorage, denyUnscopedServiceData } from "../plugin-service-storage";
import { inferenceHistoryStorage } from "../plugin-inference-history-storage";
import { resourceModelImage } from "../../../../services/model-image";
import { fetch as corsFreeFetch } from "@tauri-apps/plugin-http";
import { createPluginNetworkService } from "../plugin-network";
import { pluginOperationSignal } from "../plugin-call-options";
import { canUseHostService } from "@read-aware/core";
import { hostIO } from "../../../../services/host-io";
import { checkOperationAvailability } from "../../../../services/operation-availability";
import { hostSync } from "../../../../services/sync";
import { getAgentRuntime } from "../../../ai";
import { createPluginLlm } from "../plugin-llm";
import type { PluginContext } from "../../lib/plugin-types";
import type { PluginActorKit } from "./kit";

/** Permission-gated host services, and the data limits of a book-scoped service invocation. */
export function installHostServices(kit: PluginActorKit, ctx: PluginContext): void {
  const {
    manifest,
    serviceInvocation,
    permissions,
    selfOrigin,
    lifecycle,
    objectAccess,
    resources,
    lazy,
    operationActor,
    track,
  } = kit;
  if (canUseHostService("sync", permissions)) {
    ctx.services.sync = {
      snapshot: async () => {
        lifecycle.assertActive("services.sync.snapshot");
        return hostSync.snapshot();
      },
      backlog: () => {
        lifecycle.assertActive("services.sync.backlog");
        return hostSync.backlog(lifecycle.signal);
      },
      account: () => {
        lifecycle.assertActive("services.sync.account");
        return hostSync.account(lifecycle.signal);
      },
      requestSync: () => {
        lifecycle.assertActive("services.sync.requestSync");
        return hostSync.requestSync(lifecycle.signal, operationActor);
      },
      openSettings: () => {
        lifecycle.assertActive("services.sync.openSettings");
        return hostSync.openSettings(lifecycle.signal, operationActor);
      },
      connectionOptions: async () => {
        lifecycle.assertActive("services.sync.connectionOptions");
        return hostSync.connectionOptions();
      },
      requestFlow: (request, options) => {
        lifecycle.assertActive("services.sync.requestFlow");
        const signal = pluginOperationSignal(lifecycle.signal, options);
        return lifecycle.read(
          "services.sync.requestFlow",
          () => hostSync.requestFlow(request, signal, operationActor),
          signal,
        );
      },
      observe: (handler) => track(() => ({ dispose: hostSync.observe(handler, operationActor) })),
    };
  }

  if (canUseHostService("network", permissions)) {
    ctx.services.network = lazy.network ??= createPluginNetworkService(
      manifest.networkAccess,
      lifecycle,
      corsFreeFetch,
      selfOrigin,
    );
  }

  if (canUseHostService("llm", permissions)) {
    ctx.services.llm = lazy.llm ??= createPluginLlm(
      manifest.id,
      lifecycle,
      getAgentRuntime,
      undefined,
      (id, signal) => resourceModelImage(resources, id, signal),
      inferenceHistoryStorage(manifest.id),
      { check: checkOperationAvailability },
    );
  }

  if (canUseHostService("clipboard", permissions)) {
    ctx.services.clipboard = {
      writeImage: (id) => {
        lifecycle.assertActive("services.clipboard.writeImage");
        return resources.copyImage(id, lifecycle.signal);
      },
      writeText: (text) => {
        lifecycle.assertActive("services.clipboard.writeText");
        return hostIO.writeClipboard(text, lifecycle.signal);
      },
    };
  }

  if (canUseHostService("network", permissions)) {
    ctx.services.ui.openExternal = (url) => {
      lifecycle.assertActive("services.ui.openExternal");
      return hostIO.openExternal(url, lifecycle.signal);
    };
  }

  if (serviceInvocation && objectAccess.grant.mode === "book") {
    ctx.services.storage = bookServiceStorage(ctx.services.storage, objectAccess.grant.bookId);
    ctx.services.secrets = {
      get: denyUnscopedServiceData,
      set: denyUnscopedServiceData,
      remove: denyUnscopedServiceData,
    };
    ctx.services.resources.assets = {
      policy: denyUnscopedServiceData,
      list: denyUnscopedServiceData,
      get: denyUnscopedServiceData,
      store: denyUnscopedServiceData,
      open: denyUnscopedServiceData,
      delete: denyUnscopedServiceData,
    };
  }
}
