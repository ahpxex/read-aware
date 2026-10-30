import { copyEventCause } from "../../../../platform/domain-actor";
import { restricted, restrictSurface } from "../plugin-restricted-surface";
import type { PluginContext } from "../../lib/plugin-types";
import { pluginObjectAccessDenied } from "../../../../domain/plugin-object-access";
import { createLogger } from "../../../../platform/logger";
import type { PluginActorKit } from "./kit";

const log = createLogger("plugins");

/** Narrows the settings domain to the activation's book grant. */
export function restrictSettingsDomain(kit: PluginActorKit, ctx: PluginContext): void {
  const { selfOrigin, lifecycle, objectAccess, scopedRead, scopedCommand, settingsDomain, deliverSettingsEvent } = kit;
  if (objectAccess.restricted) {
    const rawSettings = ctx.domains.settings;
    const settingsTargetBook = (
      target: import("@read-aware/core").SettingsQueryTarget | import("@read-aware/core").SettingsTarget | undefined,
      operation: string,
    ): string | null => {
      if (!target || target.kind === "global") return null;
      if (target.kind !== "book") throw pluginObjectAccessDenied(operation);
      objectAccess.assertBook(target.bookId, operation);
      return target.bookId;
    };
    const sanitizeSettingsSnapshot = (
      snapshot: import("@read-aware/core").SettingsSnapshot,
      target: import("@read-aware/core").SettingsQueryTarget | undefined,
    ) => {
      if (!target || target.kind === "global") return { ...snapshot, overrides: [] };
      return {
        ...snapshot,
        overrides: snapshot.overrides.filter((override) => {
          objectAccess.assertReturnedBook(override.target.bookId, "settings.overrides");
          return true;
        }),
      };
    };
    const sanitizeSettingsUpdate = (
      result: import("@read-aware/core").SettingsUpdateResult,
      target: import("@read-aware/core").SettingsQueryTarget,
    ) => ({
      ...result,
      settings: sanitizeSettingsSnapshot(result.settings, target),
    });
    ctx.domains.settings = restrictSurface<PluginContext["domains"]["settings"]>(lifecycle, "domains.settings", {
      queries: {
        // Public model metadata carries no book object.
        modelCatalog: restricted.read(rawSettings.queries.modelCatalog),
        snapshot: restricted.read((query) => {
          const bookId = settingsTargetBook(query?.target, "settings.queries.snapshot");
          return bookId
            ? scopedRead(
                bookId,
                "settings.queries.snapshot",
                () => rawSettings.queries.snapshot(query),
                undefined,
                (value) => sanitizeSettingsSnapshot(value, query?.target),
              )
            : lifecycle
                .read("settings.queries.snapshot", () => rawSettings.queries.snapshot(query))
                .then((value) => sanitizeSettingsSnapshot(value, query?.target));
        }),
        observe: restricted.observe((query, handler) => {
          const bookId = settingsTargetBook(query?.target, "settings.queries.observe");
          return () => ({
            dispose: settingsDomain.queries.observe(query, (event) => {
              try {
                if (bookId) objectAccess.assertBook(bookId, "settings.queries.observe");
                if (event.status === "ready") {
                  const snapshot = sanitizeSettingsSnapshot(event.snapshot, query?.target);
                  return handler(copyEventCause(event, { ...event, snapshot }));
                } else return handler(event);
              } catch (error) {
                log.debug("settings observation outside book grant", error);
              }
            }),
          });
        }),
        // Catalog entries carry no values, but a named book target is still an object reference.
        discover: restricted.read((query) => {
          const bookId = settingsTargetBook(query?.target, "settings.queries.discover");
          return bookId
            ? scopedRead(bookId, "settings.queries.discover", () => rawSettings.queries.discover(query))
            : rawSettings.queries.discover(query);
        }),
        // The unscoped branch is the unrestricted query, including its active-phase
        // rule for plugin-owned option providers.
        options: restricted.read((query) => {
          const bookId = settingsTargetBook(query?.target, "settings.queries.options");
          return bookId
            ? scopedRead(bookId, "settings.queries.options", (signal) => settingsDomain.queries.options(query, signal))
            : rawSettings.queries.options(query);
        }),
        read: restricted.read((path, target) => {
          const bookId = settingsTargetBook(target, "settings.queries.read");
          return bookId
            ? scopedRead(
                bookId,
                "settings.queries.read",
                () => rawSettings.queries.read(path, target),
                undefined,
                (value) =>
                  objectAccess.assertReturnedBook(
                    value.target.kind === "book" ? value.target.bookId : null,
                    "settings.queries.read",
                  ),
              )
            : lifecycle.read("settings.queries.read", () => rawSettings.queries.read(path, target));
        }),
      },
      commands: {
        refreshModelCatalog: rawSettings.commands.refreshModelCatalog
          ? restricted.command(rawSettings.commands.refreshModelCatalog)
          : restricted.absent,
        update: restricted.command(async (changes) => {
          const bookIds = new Set<string>();
          for (const change of changes) {
            const bookId = settingsTargetBook(change.target, "settings.commands.update");
            if (bookId) bookIds.add(bookId);
          }
          if (bookIds.size > 1) throw pluginObjectAccessDenied("settings.commands.update");
          const bookId = [...bookIds][0];
          return bookId
            ? scopedCommand(
                bookId,
                "settings.commands.update",
                (signal) => settingsDomain.commands.update(changes, signal),
                undefined,
                true,
                (result) => {
                  sanitizeSettingsSnapshot(result.settings, { kind: "book", bookId });
                },
              ).then((result) => sanitizeSettingsUpdate(result, { kind: "book", bookId }))
            : rawSettings.commands.update(changes).then((result) => sanitizeSettingsUpdate(result, { kind: "global" }));
        }),
        resetReading: restricted.command(async (request) => {
          if (request.target.kind === "all-books") throw pluginObjectAccessDenied("settings.commands.resetReading");
          const bookId = settingsTargetBook(request.target, "settings.commands.resetReading");
          return bookId
            ? scopedCommand(
                bookId,
                "settings.commands.resetReading",
                (signal) => settingsDomain.commands.resetReading(request, signal),
                undefined,
                true,
                (result) => {
                  sanitizeSettingsSnapshot(result.settings, { kind: "book", bookId });
                },
              ).then((result) => sanitizeSettingsUpdate(result, { kind: "book", bookId }))
            : rawSettings.commands
                .resetReading(request)
                .then((result) => sanitizeSettingsUpdate(result, { kind: "global" }));
        }),
      },
      events: {
        subscribe: restricted.observe((handler, options) => () => ({
          dispose: settingsDomain.events.subscribe((event) => {
            if (options?.ignoreSelf && event.origin === selfOrigin) return;
            const changes = event.changes.flatMap((change) => {
              try {
                if (change.target?.kind === "book") {
                  objectAccess.assertBook(change.target.bookId, "settings.events.subscribe");
                } else if (change.target?.kind === "all-books") return [];
                return [change];
                // A change to a book outside the grant is withheld, not an error.
              } catch {
                return [];
              }
            });
            if (changes.length) deliverSettingsEvent(handler, copyEventCause(event, { ...event, changes }));
          }),
        })),
      },
    });
  }
}
