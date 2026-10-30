import type { PluginCallOptions, PluginReadingDomain } from "@read-aware/plugin-types";
import { restricted, restrictSurface, type RestrictedPolicy } from "../plugin-restricted-surface";
import type { PluginContext } from "../../lib/plugin-types";
import { pluginObjectAccessDenied } from "../../../../domain/plugin-object-access";
import { guardMutationTree } from "./helpers";
import { createLogger } from "../../../../platform/logger";
import type { PluginActorKit } from "./kit";

const log = createLogger("plugins");

/** The reading domain, with book-grant narrowing. */
export function installReadingDomain(
  kit: PluginActorKit,
  ctx: PluginContext,
  reading: NonNullable<PluginActorKit["domain"]["reading"]>,
): void {
  const {
    lifecycle,
    callSignal,
    currentBook,
    objectAccess,
    scopedRead,
    scopedCurrentRead,
    scopedCommand,
    scopedCurrentCommand,
    track,
    trackedOn,
  } = kit;
  ctx.domains.reading = {
    queries: reading.queries,
    events: {
      subscribe: trackedOn(reading.events.subscribe),
      observeSession: (handler) => track(() => ({ dispose: reading.events.observeSession(handler) })),
      observeEmphasis: (handler) => track(() => ({ dispose: reading.events.observeEmphasis(handler) })),
      observeTime: (query, handler) => track(() => ({ dispose: reading.events.observeTime(query, handler) })),
    },
  };
  if (reading.commands) {
    ctx.domains.reading.commands = guardMutationTree(
      {
        setFinished: reading.commands.setFinished,
        putEmphasis: (
          input: import("@read-aware/core").ReadingEmphasisWrite,
          guard?: import("@read-aware/core").ReadingSessionGuard,
          options?: PluginCallOptions,
        ) => reading.commands!.putEmphasis(input, callSignal(options), guard),
        removeEmphasis: (
          input: import("@read-aware/core").ReadingEmphasisRef,
          guard?: import("@read-aware/core").ReadingSessionGuard,
          options?: PluginCallOptions,
        ) => reading.commands!.removeEmphasis(input, callSignal(options), guard),
        selectRange: (
          range: import("@read-aware/core").BookTextRange,
          guard?: import("@read-aware/core").ReadingSessionGuard,
          options?: PluginCallOptions,
        ) => reading.commands!.selectRange(range, callSignal(options), guard),
        clearSelection: (
          expectedId: string,
          guard?: import("@read-aware/core").ReadingSessionGuard,
          options?: PluginCallOptions,
        ) => reading.commands!.clearSelection(expectedId, callSignal(options), guard),
        openBook: (bookId: string, options?: PluginCallOptions) =>
          reading.commands!.openBook(bookId, callSignal(options)),
        goTo: (target: import("@read-aware/core").ReadingTarget, options?: PluginCallOptions) =>
          reading.commands!.goTo(target, callSignal(options)),
        back: (guard?: import("@read-aware/core").ReadingSessionGuard, options?: PluginCallOptions) =>
          reading.commands!.back(callSignal(options), guard),
        forward: (guard?: import("@read-aware/core").ReadingSessionGuard, options?: PluginCallOptions) =>
          reading.commands!.forward(callSignal(options), guard),
        step: (
          direction: import("@read-aware/core").ReadingStep,
          guard?: import("@read-aware/core").ReadingSessionGuard,
          options?: PluginCallOptions,
        ) => reading.commands!.step(direction, callSignal(options), guard),
        reload: (guard?: import("@read-aware/core").ReadingSessionGuard, options?: PluginCallOptions) =>
          reading.commands!.reload(callSignal(options), guard),
        close: (guard?: import("@read-aware/core").ReadingSessionGuard, options?: PluginCallOptions) =>
          reading.commands!.close(callSignal(options), guard),
        controlPlayback: (
          action: "start" | "stop",
          guard?: import("@read-aware/core").ReadingSessionGuard,
          options?: PluginCallOptions,
        ) => reading.commands!.controlPlayback(action, callSignal(options), guard),
        configureMode: (
          input: import("@read-aware/core").ReadingModeConfiguration,
          guard?: import("@read-aware/core").ReadingSessionGuard,
          options?: PluginCallOptions,
        ) => reading.commands!.configureMode(input, callSignal(options), guard),
        setControls: (
          visible: boolean,
          guard?: import("@read-aware/core").ReadingSessionGuard,
          options?: PluginCallOptions,
        ) => reading.commands!.setControls(visible, callSignal(options), guard),
        returnToMode: (guard?: import("@read-aware/core").ReadingSessionGuard, options?: PluginCallOptions) =>
          reading.commands!.returnToMode(callSignal(options), guard),
        stepMode: (
          direction: "next" | "previous",
          guard?: import("@read-aware/core").ReadingSessionGuard,
          options?: PluginCallOptions,
        ) => reading.commands!.stepMode(direction, callSignal(options), guard),
      },
      (operation) => lifecycle.assertActive(operation),
      "domains.reading.commands",
    );
  }
  if (objectAccess.restricted) {
    const rawQueries = reading.queries;
    const verifySession = (session: import("@read-aware/core").ReadingSessionSnapshot): void => {
      objectAccess.assertReturnedBook(session.bookId, "reading.queries.session");
      if (session.location) objectAccess.assertReturnedBook(session.location.bookId, "reading.queries.session");
      if (session.selection?.range)
        objectAccess.assertReturnedBook(session.selection.range.bookId, "reading.queries.session");
    };
    const commandPolicy = (
      rawCommands: NonNullable<typeof reading.commands>,
    ): RestrictedPolicy<NonNullable<PluginReadingDomain["commands"]>> => {
      const verifyNavigation =
        (operation: string) =>
        (value: import("@read-aware/core").ReadingNavigationReceipt): void => {
          objectAccess.assertReturnedBook(value.location.bookId, operation);
        };
      const verifyModeReceipt =
        (operation: string) =>
        (value: import("@read-aware/core").ReadingModeReceipt): void => {
          if (value.mode.position) objectAccess.assertReturnedBook(value.mode.position.location.bookId, operation);
        };
      return {
        putEmphasis: restricted.command((input, guard, options) => {
          const bookId = input?.ranges?.[0]?.bookId;
          if (!bookId || input.ranges.some((range) => range.bookId !== bookId))
            throw pluginObjectAccessDenied("reading.commands.putEmphasis");
          return scopedCommand(
            bookId,
            "reading.commands.putEmphasis",
            (signal) => rawCommands.putEmphasis(input, signal, guard),
            options,
            true,
            (value) => objectAccess.assertReturnedBook(value.emphasis.bookId, "reading.commands.putEmphasis"),
          );
        }),
        removeEmphasis: restricted.command((input, guard, options) =>
          scopedCurrentCommand(
            "reading.commands.removeEmphasis",
            (signal) => rawCommands.removeEmphasis(input, signal, guard),
            options,
            true,
          ),
        ),
        selectRange: restricted.command((range, guard, options) =>
          scopedCommand(
            range.bookId,
            "reading.commands.selectRange",
            (signal) => rawCommands.selectRange(range, signal, guard),
            options,
            true,
            (value) => {
              if (value.selection?.range)
                objectAccess.assertReturnedBook(value.selection.range.bookId, "reading.commands.selectRange");
            },
          ),
        ),
        clearSelection: restricted.command((expectedId, guard, options) =>
          scopedCurrentCommand(
            "reading.commands.clearSelection",
            (signal) => rawCommands.clearSelection(expectedId, signal, guard),
            options,
            true,
            (value) => {
              if (value.selection?.range)
                objectAccess.assertReturnedBook(value.selection.range.bookId, "reading.commands.clearSelection");
            },
          ),
        ),
        setControls: restricted.command((visible, guard, options) =>
          scopedCurrentCommand(
            "reading.commands.setControls",
            (signal) => rawCommands.setControls(visible, signal, guard),
            options,
          ),
        ),
        setFinished: restricted.command((bookId, finished) =>
          scopedCommand(
            bookId,
            "reading.commands.setFinished",
            () => rawCommands.setFinished(bookId, finished),
            undefined,
            false,
          ),
        ),
        openBook: restricted.command((bookId, options) =>
          scopedCommand(
            bookId,
            "reading.commands.openBook",
            (signal) => rawCommands.openBook(bookId, signal),
            options,
            true,
            verifyNavigation("reading.commands.openBook"),
            { allowSessionChange: true },
          ),
        ),
        goTo: restricted.command((target, options) => {
          if (target?.bookId)
            return scopedCommand(
              target.bookId,
              "reading.commands.goTo",
              (signal) => rawCommands.goTo(target, signal),
              options,
              true,
              verifyNavigation("reading.commands.goTo"),
            );
          return scopedCurrentCommand(
            "reading.commands.goTo",
            (signal) => rawCommands.goTo(target, signal),
            options,
            true,
            verifyNavigation("reading.commands.goTo"),
          );
        }),
        back: restricted.command((guard, options) =>
          scopedCurrentCommand(
            "reading.commands.back",
            (signal) => rawCommands.back(signal, guard),
            options,
            true,
            verifyNavigation("reading.commands.back"),
          ),
        ),
        forward: restricted.command((guard, options) =>
          scopedCurrentCommand(
            "reading.commands.forward",
            (signal) => rawCommands.forward(signal, guard),
            options,
            true,
            verifyNavigation("reading.commands.forward"),
          ),
        ),
        step: restricted.command((direction, guard, options) =>
          scopedCurrentCommand(
            "reading.commands.step",
            (signal) => rawCommands.step(direction, signal, guard),
            options,
            true,
            verifyNavigation("reading.commands.step"),
          ),
        ),
        reload: restricted.command((guard, options) =>
          scopedCurrentCommand(
            "reading.commands.reload",
            (signal) => rawCommands.reload(signal, guard),
            options,
            true,
            verifyNavigation("reading.commands.reload"),
            { allowSessionChange: true },
          ),
        ),
        close: restricted.command((guard, options) =>
          scopedCurrentCommand(
            "reading.commands.close",
            (signal) => rawCommands.close(signal, guard),
            options,
            true,
            undefined,
            { allowClose: true },
          ),
        ),
        controlPlayback: restricted.command((action, guard, options) =>
          scopedCurrentCommand(
            "reading.commands.controlPlayback",
            (signal) => rawCommands.controlPlayback(action, signal, guard),
            options,
          ),
        ),
        configureMode: restricted.command((input, guard, options) =>
          scopedCurrentCommand(
            "reading.commands.configureMode",
            (signal) => rawCommands.configureMode(input, signal, guard),
            options,
            true,
            verifyModeReceipt("reading.commands.configureMode"),
          ),
        ),
        returnToMode: restricted.command((guard, options) =>
          scopedCurrentCommand(
            "reading.commands.returnToMode",
            (signal) => rawCommands.returnToMode(signal, guard),
            options,
            true,
            verifyNavigation("reading.commands.returnToMode"),
          ),
        ),
        stepMode: restricted.command((direction, guard, options) =>
          scopedCurrentCommand(
            "reading.commands.stepMode",
            (signal) => rawCommands.stepMode(direction, signal, guard),
            options,
            true,
            verifyModeReceipt("reading.commands.stepMode"),
          ),
        ),
      };
    };
    ctx.domains.reading = restrictSurface<PluginReadingDomain>(lifecycle, "domains.reading", {
      queries: {
        emphasis: restricted.read(() =>
          scopedCurrentRead(
            "reading.queries.emphasis",
            () => rawQueries.emphasis(),
            undefined,
            (emphasis) => {
              for (const item of emphasis) objectAccess.assertReturnedBook(item.bookId, "reading.queries.emphasis");
            },
          ),
        ),
        session: restricted.read(() =>
          scopedCurrentRead("reading.queries.session", () => rawQueries.session(), undefined, verifySession),
        ),
        stats: {
          time: restricted.read((query) => {
            if (!query?.bookId) throw pluginObjectAccessDenied("reading.queries.stats.time");
            if (query.after && query.after.bookId !== query.bookId)
              throw pluginObjectAccessDenied("reading.queries.stats.time");
            return scopedRead(
              query.bookId,
              "reading.queries.stats.time",
              () => rawQueries.stats.time(query),
              undefined,
              (value) => {
                objectAccess.assertReturnedBook(value.bookId, "reading.queries.stats.time");
                if (value.nextCursor)
                  objectAccess.assertReturnedBook(value.nextCursor.bookId, "reading.queries.stats.time");
                for (const item of value.pending)
                  objectAccess.assertReturnedBook(item.bookId, "reading.queries.stats.time");
              },
            );
          }),
          insights: restricted.read((query) => {
            if (!query?.bookId) throw pluginObjectAccessDenied("reading.queries.stats.insights");
            return scopedRead(
              query.bookId,
              "reading.queries.stats.insights",
              () => rawQueries.stats.insights(query),
              undefined,
              (value) => {
                objectAccess.assertReturnedBook(value.bookId, "reading.queries.stats.insights");
                if (value.achievements.mostReadBookId)
                  objectAccess.assertReturnedBook(value.achievements.mostReadBookId, "reading.queries.stats.insights");
              },
            );
          }),
          forBook: restricted.read((bookId) =>
            scopedRead(
              bookId,
              "reading.queries.stats.forBook",
              () => rawQueries.stats.forBook(bookId),
              undefined,
              (value) => {
                if (value) objectAccess.assertReturnedBook(value.bookId, "reading.queries.stats.forBook");
              },
            ),
          ),
          list: restricted.deny,
          overview: restricted.deny,
        },
      },
      events: {
        subscribe: restricted.deny,
        observeSession: restricted.observe((handler) => {
          objectAccess.assertBook(currentBook().bookId ?? "", "reading.events.observeSession");
          return () => ({
            dispose: reading.events.observeSession((snapshot) => {
              try {
                verifySession(snapshot);
              } catch (error) {
                log.debug("reading session outside book grant", error);
                return;
              }
              return handler(snapshot);
            }),
          });
        }),
        observeEmphasis: restricted.observe((handler) => {
          objectAccess.assertBook(currentBook().bookId ?? "", "reading.events.observeEmphasis");
          return () => ({
            dispose: reading.events.observeEmphasis((snapshot) => {
              try {
                for (const item of snapshot)
                  objectAccess.assertReturnedBook(item.bookId, "reading.events.observeEmphasis");
              } catch (error) {
                log.debug("reading emphasis outside book grant", error);
                return;
              }
              return handler(snapshot);
            }),
          });
        }),
        observeTime: restricted.observe((query, handler) => {
          if (!query?.bookId) throw pluginObjectAccessDenied("reading.events.observeTime");
          const bookId = query.bookId;
          objectAccess.assertBook(bookId, "reading.events.observeTime");
          return () => ({
            dispose: reading.events.observeTime(query, (event) => {
              try {
                objectAccess.assertBook(bookId, "reading.events.observeTime");
                if (event.status === "ready") {
                  objectAccess.assertReturnedBook(event.snapshot.bookId, "reading.events.observeTime");
                  if (event.snapshot.nextCursor)
                    objectAccess.assertReturnedBook(event.snapshot.nextCursor.bookId, "reading.events.observeTime");
                }
              } catch (error) {
                log.debug("reading time outside book grant", error);
                return;
              }
              return handler(event);
            }),
          });
        }),
      },
      commands: reading.commands ? commandPolicy(reading.commands) : restricted.absent,
    });
  }
}
