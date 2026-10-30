import { pluginServices } from "../plugin-services";
import { canUseHostService, normalizeOperationAvailability, operationAvailability } from "@read-aware/core";
import { hostEnvironment } from "../../../../platform/host-environment";
import { checkOperationAvailability } from "../../../../services/operation-availability";
import { pluginSchedules } from "../plugin-scheduler";
import type { PluginContext } from "../../lib/plugin-types";
import type { PluginActorKit } from "./kit";

/** Session queries: operation availability for every gated host operation, and the host environment. */
export function sessionServiceFacet(kit: PluginActorKit): PluginContext["services"]["session"] {
  const {
    manifest,
    permissions,
    lifecycle,
    callSignal,
    objectAccess,
    scopedRead,
    resources,
    owners,
    serviceParticipant,
    operationActor,
    settingsDomain,
    track,
    availability,
  } = kit;
  return {
    operationAvailability: (input, options) => {
      lifecycle.assertActive("services.session.operationAvailability");
      const signal = callSignal(options);
      signal.throwIfAborted();
      const query = normalizeOperationAvailability(input);
      if (query.operation === "clipboard.writeText" || query.operation === "ui.openExternal") {
        const service = query.operation === "clipboard.writeText" ? "clipboard" : "network";
        if (!canUseHostService(service, permissions))
          return Promise.resolve(
            operationAvailability(query, [
              { kind: "permission", state: "unavailable", reason: `service:${service}-required` },
            ]),
          );
        return lifecycle.read(
          "services.session.operationAvailability",
          () => checkOperationAvailability(query, signal),
          signal,
        );
      }
      if (query.operation === "resources.save" || query.operation === "resources.openAssociated") {
        return lifecycle.read(
          "services.session.operationAvailability",
          async () => operationAvailability(query, await resources.conditions(query, signal)),
          signal,
        );
      }
      if (query.operation === "schedules.control") {
        if (query.schedule.pluginId !== manifest.id)
          return Promise.resolve(
            operationAvailability(query, [
              {
                kind: "permission",
                state: "unavailable",
                reason: "schedule-owner-required",
                errorCode: "plugin/permission-denied",
              },
            ]),
          );
        return lifecycle.read(
          "services.session.operationAvailability",
          async () => operationAvailability(query, pluginSchedules.conditions(query.schedule)),
          signal,
        );
      }
      if (query.operation === "settings.refreshModelCatalog") {
        return lifecycle.read(
          "services.session.operationAvailability",
          async () =>
            operationAvailability(query, settingsDomain.queries.modelCatalogRefreshConditions(query.provider)),
          signal,
        );
      }
      if (query.operation === "ui.commands.execute") {
        if (!permissions.has("library:write") || !availability.command)
          return Promise.resolve(
            operationAvailability(query, [
              { kind: "permission", state: "unavailable", reason: "library:write-required" },
            ]),
          );
        const check = availability.command;
        return lifecycle.read("services.session.operationAvailability", () => check(query.command, signal), signal);
      }
      if (query.operation === "plugins.callService") {
        return lifecycle.read(
          "services.session.operationAvailability",
          async () => pluginServices.inspect(serviceParticipant(operationActor), query.serviceCall),
          signal,
        );
      }
      if (query.operation === "ui.exportFile") {
        return lifecycle.read(
          "services.session.operationAvailability",
          () => checkOperationAvailability(query, signal),
          signal,
        );
      }
      if (query.operation === "window.control") {
        return lifecycle.read(
          "services.session.operationAvailability",
          () => checkOperationAvailability(query, signal),
          signal,
        );
      }
      if (
        query.operation === "maintenance.requestBackup" ||
        query.operation === "maintenance.requestConnectionTest" ||
        query.operation === "diagnostics.requestReport" ||
        query.operation === "diagnostics.requestProjectionRepair"
      ) {
        if (query.operation.startsWith("diagnostics.") && !canUseHostService("diagnostics", permissions))
          return Promise.resolve(
            operationAvailability(query, [
              { kind: "permission", state: "unavailable", reason: "service:diagnostics-required" },
            ]),
          );
        return lifecycle.read(
          "services.session.operationAvailability",
          () => checkOperationAvailability(query, signal),
          signal,
        );
      }
      if (query.operation === "diagnostics.verifyProjections") {
        if (!canUseHostService("diagnostics", permissions))
          return Promise.resolve(
            operationAvailability(query, [
              { kind: "permission", state: "unavailable", reason: "service:diagnostics-required" },
            ]),
          );
        return lifecycle.read(
          "services.session.operationAvailability",
          () => checkOperationAvailability(query, signal),
          signal,
        );
      }
      if (query.operation === "maintenance.checkForUpdates") {
        if (!canUseHostService("network", permissions))
          return Promise.resolve(
            operationAvailability(query, [
              { kind: "permission", state: "unavailable", reason: "service:network-required" },
            ]),
          );
        return lifecycle.read(
          "services.session.operationAvailability",
          () => checkOperationAvailability(query, signal),
          signal,
        );
      }
      if (query.operation === "sync.now" || query.operation === "sync.requestFlow") {
        if (!canUseHostService("sync", permissions))
          return Promise.resolve(
            operationAvailability(query, [
              { kind: "permission", state: "unavailable", reason: "service:sync-required" },
            ]),
          );
        return lifecycle.read(
          "services.session.operationAvailability",
          () => checkOperationAvailability(query, signal),
          signal,
        );
      }
      if (query.operation !== "llm.infer") {
        const permission =
          query.operation === "library.text.prepare"
            ? "library:write"
            : query.operation === "memory.graph.generate"
              ? "memory:write"
              : "reading:write";
        if (!permissions.has(permission))
          return Promise.resolve(
            operationAvailability(query, [
              { kind: "permission", state: "unavailable", reason: `${permission}-required` },
            ]),
          );
        if (query.operation === "memory.graph.generate" && !canUseHostService("llm", permissions))
          return Promise.resolve(
            operationAvailability(query, [
              { kind: "permission", state: "unavailable", reason: "service:llm-required" },
            ]),
          );
        try {
          objectAccess.assertBook(query.bookId, "services.session.operationAvailability");
        } catch {
          return Promise.resolve(
            operationAvailability(query, [
              {
                kind: "permission",
                state: "unavailable",
                reason: "book-scope-required",
                errorCode: "plugin/object-access-denied",
              },
            ]),
          );
        }
        return scopedRead(
          query.bookId,
          "services.session.operationAvailability",
          (signal) =>
            checkOperationAvailability(query, signal, {
              textPreparation: owners.textTasks,
              graphTasks: owners.graphTasks,
            }),
          options,
        );
      }
      if (!canUseHostService("llm", permissions))
        return Promise.resolve(
          operationAvailability(query, [{ kind: "permission", state: "unavailable", reason: "service:llm-required" }]),
        );
      return lifecycle.read(
        "services.session.operationAvailability",
        () => checkOperationAvailability(query, signal),
        signal,
      );
    },
    environment: async () => {
      lifecycle.assertActive("services.session.environment");
      return hostEnvironment.snapshot();
    },
    observeEnvironment: (handler) => track(() => ({ dispose: hostEnvironment.observe(handler) })),
  };
}
