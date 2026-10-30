import { observeSnapshot } from "../../../../domain/snapshot-observation";
import { pluginServices } from "../plugin-services";
import { copyEventCause } from "../../../../platform/domain-actor";
import { createPluginStoragePolicy } from "../plugin-storage-policy";
import { pluginDurableKV } from "../plugin-durable-kv";
import type { PluginCallOptions } from "@read-aware/plugin-types";
import { pluginOperationSignal } from "../plugin-call-options";
import { publishPluginView } from "../../lib/plugin-view-channels";
import { AppError, canUseHostService } from "@read-aware/core";
import { onAppEvent } from "../../../../platform/app-events";
import { hostIO } from "../../../../services/host-io";
import { pluginDirectory } from "../../../../services/plugin-directory";
import { flushLocalKV, localKV } from "../../../../platform/local-store";
import { hostWindow } from "../../../../services/window";
import { hostMaintenance } from "../../../../services/maintenance";
import { hostDiagnostics } from "../../../../services/diagnostics";
import { createPluginAssets } from "../plugin-assets";
import { deletePluginSecret, getPluginSecret, setPluginSecret } from "../../../../platform/secret-store";
import { showPluginToast } from "../../lib/plugin-toast";
import { pluginSchedules, registerPluginSchedule } from "../plugin-scheduler";
import type { PluginContext } from "../../lib/plugin-types";
import { requireSecretKey } from "./helpers";
import { createLogger } from "../../../../platform/logger";
import type { PluginActorKit } from "./kit";
import { sessionServiceFacet } from "./session";

const log = createLogger("plugins");

/** Host services every plugin receives; permission-gated services are added by installHostServices. */
export function servicesFacet(kit: PluginActorKit): PluginContext["services"] {
  const {
    manifest,
    permissions,
    lifecycle,
    callSignal,
    scopedRead,
    resources,
    logging,
    serviceParticipant,
    operationActor,
    documents,
    transactions,
    jobs,
    transactionCall,
    changes,
    storagePrefix,
    track,
    trackContribution,
  } = kit;
  return {
    storage: {
      policy: createPluginStoragePolicy(manifest.id, lifecycle),
      getDurable: pluginDurableKV(lifecycle, storagePrefix),
      get: (key) => {
        const raw = localKV.getItem(storagePrefix + key);
        if (raw == null) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        if (typeof key !== "string" || key === "schedule-state" || key === "schedule-runs")
          throw new AppError("plugin/invalid-input", "Schedule receipts are host-owned");
        return lifecycle.storageWrite("services.storage.set", () =>
          localKV.setItemAsync(storagePrefix + key, JSON.stringify(value ?? null), operationActor),
        );
      },
      remove: (key) => {
        if (typeof key !== "string" || key === "schedule-state" || key === "schedule-runs")
          throw new AppError("plugin/invalid-input", "Schedule receipts are host-owned");
        return lifecycle.storageWrite("services.storage.remove", () =>
          localKV.removeItemAsync(storagePrefix + key, operationActor),
        );
      },
      flush: async () => {
        await lifecycle.drainStorageWrites();
        await flushLocalKV(storagePrefix);
      },
      onChange: (handler) =>
        track(() => ({
          dispose: observeSnapshot(
            () => ({ kind: "changed" as const }),
            (notify) =>
              onAppEvent("plugin-storage-changed", (event) => {
                if (event.pluginId === manifest.id) notify(event);
              }),
            (value, source) => handler(copyEventCause(source, value)),
            (error) => log.error(`storage.onChange handler from "${manifest.id}" failed`, error),
            operationActor,
            false,
          ),
        })),
      ...documents,
    },
    secrets: {
      get: (key) => {
        lifecycle.assertActive("services.secrets.get");
        requireSecretKey(key);
        return getPluginSecret(manifest.id, key);
      },
      set: async (key, value) => {
        lifecycle.assertActive("services.secrets.set");
        requireSecretKey(key);
        await lifecycle.storageWrite("services.secrets.set", () =>
          setPluginSecret(manifest.id, key, String(value), operationActor),
        );
      },
      remove: async (key) => {
        lifecycle.assertActive("services.secrets.remove");
        requireSecretKey(key);
        await lifecycle.storageWrite("services.secrets.remove", () =>
          deletePluginSecret(manifest.id, key, operationActor),
        );
      },
    },
    ui: {
      window: {
        snapshot: () => {
          lifecycle.assertActive("services.ui.window.snapshot");
          return lifecycle.read("services.ui.window.snapshot", () => hostWindow.snapshot(lifecycle.signal));
        },
        observe: (handler) => track(() => ({ dispose: hostWindow.observe(handler, operationActor) })),
        control: (request) => {
          lifecycle.assertActive("services.ui.window.control");
          return lifecycle.read("services.ui.window.control", () =>
            hostWindow.control(request, lifecycle.signal, operationActor),
          );
        },
      },
      publishView: async (channel, update) => {
        lifecycle.assertActive("services.ui.publishView");
        return publishPluginView(lifecycle.signal, channel, update);
      },
      showToast: (message) => {
        lifecycle.assertActive("services.ui.showToast");
        showPluginToast(message, lifecycle.signal);
      },
      exportFile: (file) => {
        lifecycle.assertActive("services.ui.exportFile");
        return hostIO.exportFile(file, lifecycle.signal);
      },
    },
    schedules: {
      defer: (id, input, options) => {
        lifecycle.assertActive("services.schedules.defer");
        return lifecycle.storageWrite("services.schedules.defer", () =>
          pluginSchedules.defer(manifest.id, id, input, callSignal(options), operationActor),
        );
      },
      cancelDeferred: (id, requestId, options) => {
        lifecycle.assertActive("services.schedules.cancelDeferred");
        return lifecycle.storageWrite("services.schedules.cancelDeferred", () =>
          pluginSchedules.cancelDeferred(manifest.id, id, requestId, callSignal(options), operationActor),
        );
      },
      list: async (query = {}) => {
        lifecycle.assertActive("services.schedules.list");
        return pluginSchedules.list({ ...query, pluginId: manifest.id });
      },
      observe: (query, handler) =>
        track(() => ({
          dispose: pluginSchedules.observe({ ...query, pluginId: manifest.id }, handler, operationActor),
        })),
      control: (id, action) => {
        lifecycle.assertActive("services.schedules.control");
        return pluginSchedules.control({ pluginId: manifest.id, id, action }, lifecycle.signal, operationActor);
      },
      bind: (scheduleId, run) => {
        const declaration = manifest.schedules?.find((entry) => entry.id === scheduleId);
        if (!declaration) {
          throw new Error(`schedule "${scheduleId}" is not declared in manifest.schedules`);
        }
        return trackContribution((source) => {
          const registration = registerPluginSchedule(manifest.id, declaration, run, manifest.version, source);
          return {
            dispose: (retirement) => {
              registration.dispose(retirement);
              lifecycle.trackCleanup(pluginSchedules.drainWrites(manifest.id));
            },
          };
        });
      },
    },
    changes: {
      open: (query, options) => transactionCall(() => changes.open(query, callSignal(options))),
      read: (query, cursor, limit, options) =>
        transactionCall(() => changes.read(query, cursor, limit, callSignal(options))),
    },
    jobs: {
      start: (plan, options) => transactionCall(() => jobs().start(plan, callSignal(options), operationActor)),
      get: async (id, options) => {
        const signal = callSignal(options);
        signal.throwIfAborted();
        const value = await jobs().get(id, signal);
        signal.throwIfAborted();
        return value;
      },
      list: async (query, options) => {
        const signal = callSignal(options);
        signal.throwIfAborted();
        const value = await jobs().list(query, signal);
        signal.throwIfAborted();
        return value;
      },
      control: (id, action, options) => transactionCall(() => jobs().control(id, action, callSignal(options))),
    },
    transactions: {
      preview: (operations, options) => transactionCall(() => transactions().preview(operations, callSignal(options))),
      commit: (id, options) => transactionCall(() => transactions().commit(id, callSignal(options))),
      previewUndo: (id, options) => transactionCall(() => transactions().previewUndo(id, callSignal(options))),
      receipt: (id, options) => transactionCall(() => transactions().receipt(id, callSignal(options))),
    },
    plugins: {
      listServices: async (query, options) => {
        callSignal(options).throwIfAborted();
        return pluginServices.list(serviceParticipant(operationActor), query);
      },
      callService: (request, options) =>
        pluginServices.call(serviceParticipant(operationActor), request, callSignal(options)),
      contributions: async (query) => {
        lifecycle.assertActive("services.plugins.contributions");
        return pluginDirectory.contributions(query);
      },
      observeContributions: (query, handler) =>
        track(() => ({ dispose: pluginDirectory.observeContributions(query, handler, operationActor) })),
      list: async (query) => {
        lifecycle.assertActive("services.plugins.list");
        return pluginDirectory.list(query);
      },
      observe: (query, handler) => track(() => ({ dispose: pluginDirectory.observe(query, handler, operationActor) })),
    },
    logging,
    ...(canUseHostService("diagnostics", permissions)
      ? {
          diagnostics: {
            requestProjectionRepair: (options) =>
              lifecycle.read(
                "services.diagnostics.requestProjectionRepair",
                (signal) => hostDiagnostics.requestProjectionRepair(signal, operationActor),
                pluginOperationSignal(lifecycle.signal, options),
              ),
            requestReport: (action, options) =>
              lifecycle.read(
                "services.diagnostics.requestReport",
                (signal) => hostDiagnostics.requestReport(action, signal, operationActor),
                pluginOperationSignal(lifecycle.signal, options),
              ),
            verifyProjections: (options?: PluginCallOptions) =>
              lifecycle.read(
                "services.diagnostics.verifyProjections",
                (signal) => hostDiagnostics.verifyProjections(signal, operationActor),
                callSignal(options),
              ),
          },
        }
      : {}),
    maintenance: {
      requestConnectionTest: (options) =>
        lifecycle.read(
          "services.maintenance.requestConnectionTest",
          (signal) => hostMaintenance.requestConnectionTest(signal, operationActor),
          callSignal(options),
        ),
      requestBackup: (action, options) =>
        lifecycle.read(
          "services.maintenance.requestBackup",
          (signal) => hostMaintenance.requestBackup(action, signal, operationActor),
          callSignal(options),
        ),
      snapshot: async () => {
        lifecycle.assertActive("services.maintenance.snapshot");
        return hostMaintenance.snapshot();
      },
      observe: (handler) => track(() => ({ dispose: hostMaintenance.observe(handler, operationActor) })),
      openSettings: (surface) => {
        lifecycle.assertActive("services.maintenance.openSettings");
        return hostMaintenance.openSettings(surface, lifecycle.signal, operationActor);
      },
      ...(canUseHostService("network", permissions)
        ? {
            checkForUpdates: () => {
              lifecycle.assertActive("services.maintenance.checkForUpdates");
              return hostMaintenance.checkForUpdates(lifecycle.signal, operationActor);
            },
          }
        : {}),
    },
    resources: {
      pickDirectory: () => {
        lifecycle.assertActive("services.resources.pickDirectory");
        return resources.pickDirectory(lifecycle.signal);
      },
      listDirectory: (id, query) => {
        lifecycle.assertActive("services.resources.listDirectory");
        return resources.listDirectory(id, query, lifecycle.signal);
      },
      openDirectoryFile: (id, path) => {
        lifecycle.assertActive("services.resources.openDirectoryFile");
        return resources.openDirectoryFile(id, path, lifecycle.signal);
      },
      releaseDirectory: (id) => {
        lifecycle.assertActive("services.resources.releaseDirectory");
        return resources.releaseDirectory(id);
      },
      assets: createPluginAssets(manifest.id, lifecycle, resources),
      pick: (options) => {
        lifecycle.assertActive("services.resources.pick");
        return resources.pick(options, lifecycle.signal);
      },
      ...(permissions.has("library:read") || permissions.has("library:write")
        ? {
            openBook: (bookId: string) =>
              scopedRead(bookId, "services.resources.openBook", (signal) => resources.openBook(bookId, signal)),
            openCover: (bookId: string) =>
              scopedRead(bookId, "services.resources.openCover", (signal) => resources.openCover(bookId, signal)),
          }
        : {}),
      create: (options) => {
        lifecycle.assertActive("services.resources.create");
        return resources.create(options, lifecycle.signal);
      },
      stat: (id) => {
        lifecycle.assertActive("services.resources.stat");
        return resources.stat(id, lifecycle.signal);
      },
      read: (id, offset, length) => {
        lifecycle.assertActive("services.resources.read");
        return resources.read(id, offset, length, lifecycle.signal);
      },
      append: (id, offset, data) => {
        lifecycle.assertActive("services.resources.append");
        return resources.append(id, offset, data, lifecycle.signal);
      },
      commit: (id) => {
        lifecycle.assertActive("services.resources.commit");
        return resources.commit(id, lifecycle.signal);
      },
      save: (id, filename) => {
        lifecycle.assertActive("services.resources.save");
        return resources.save(id, filename, lifecycle.signal);
      },
      openAssociated: (id, options) => {
        lifecycle.assertActive("services.resources.openAssociated");
        return resources.openAssociated(id, callSignal(options));
      },
      release: (id) => {
        lifecycle.assertActive("services.resources.release");
        return resources.release(id);
      },
    },
    session: sessionServiceFacet(kit),
  };
}
