import type { PluginAnnotationsDomain } from "@read-aware/plugin-types";
import { restricted, restrictSurface, type RestrictedPolicy } from "../plugin-restricted-surface";
import { AppError } from "@read-aware/core";
import type { PluginContext } from "../../lib/plugin-types";
import { pluginObjectAccessDenied } from "../../../../domain/plugin-object-access";
import { combinePluginSignals, guardMutationTree } from "./helpers";
import { createLogger } from "../../../../platform/logger";
import type { PluginActorKit } from "./kit";

const log = createLogger("plugins");

/** The annotations domain, with book-grant narrowing. */
export function installAnnotationsDomain(
  kit: PluginActorKit,
  ctx: PluginContext,
  annotations: NonNullable<PluginActorKit["domain"]["annotations"]>,
): void {
  const { lifecycle, objectAccess, scopedRead, scopedCommand, domain, track, trackedOn } = kit;
  ctx.domains.annotations = {
    queries: annotations.queries,
    events: {
      subscribe: trackedOn(annotations.events.subscribe),
      observe: (query, handler) => track(() => ({ dispose: annotations.events.observe(query, handler) })),
    },
  };
  if (annotations.commands) {
    ctx.domains.annotations.commands = guardMutationTree(
      {
        createHighlight: async (input: Parameters<NonNullable<typeof annotations.commands>["createHighlight"]>[0]) => {
          if (input.range !== undefined && !domain.library)
            throw new AppError("annotations/forbidden", "Range validation requires library read access");
          return annotations.commands!.createHighlight(input, lifecycle.signal);
        },
        applyChanges: (changes: import("@read-aware/core").AnnotationMutation[]) =>
          annotations.commands!.applyChanges(changes, lifecycle.signal),
        createNote: async (input: Parameters<NonNullable<typeof annotations.commands>["createNote"]>[0]) => {
          if (input.range !== undefined && !domain.library)
            throw new AppError("annotations/forbidden", "Range validation requires library read access");
          return annotations.commands!.createNote(input, lifecycle.signal);
        },
      },
      (operation) => lifecycle.assertActive(operation),
      "domains.annotations.commands",
    );
  }
  if (objectAccess.restricted) {
    const rawQueries = annotations.queries;
    const verifyAnnotation =
      (operation: string) =>
      (value: import("@read-aware/core").AnnotationSnapshot | import("@read-aware/core").AnnotationItem | null) => {
        if (value)
          objectAccess.assertReturnedBook("annotation" in value ? value.annotation.bookId : value.bookId, operation);
      };
    const verifyPage = (operation: string) => (page: import("@read-aware/core").AnnotationPage) => {
      for (const item of page.items) objectAccess.assertReturnedBook(item.bookId, operation);
    };
    const commandPolicy = (
      rawCommands: NonNullable<typeof annotations.commands>,
    ): RestrictedPolicy<NonNullable<PluginAnnotationsDomain["commands"]>> => ({
      applyChanges: restricted.command(async (changes) => {
        if (!Array.isArray(changes) || changes.length === 0)
          throw pluginObjectAccessDenied("annotations.commands.applyChanges");
        const snapshots = await Promise.all(changes.map((change) => annotations.queries.inspect(change.annotationId)));
        const bookIds = new Set<string>();
        for (const snapshot of snapshots) {
          if (!snapshot) throw pluginObjectAccessDenied("annotations.commands.applyChanges");
          objectAccess.assertReturnedBook(snapshot.annotation.bookId, "annotations.commands.applyChanges");
          bookIds.add(snapshot.annotation.bookId);
        }
        if (bookIds.size !== 1) throw pluginObjectAccessDenied("annotations.commands.applyChanges");
        const bookId = [...bookIds][0];
        const fence = await objectAccess.beginBook(bookId, "annotations.commands.applyChanges");
        try {
          const result = await rawCommands.applyChanges(changes, combinePluginSignals(lifecycle.signal, fence.signal));
          await fence.assertUnchanged();
          return result;
        } catch (error) {
          fence.dispose();
          throw error;
        }
      }),
      createHighlight: restricted.command(async (input) => {
        // Same permission rule as the unrestricted command: range validation reads the book source.
        if (input.range !== undefined && !domain.library)
          throw new AppError("annotations/forbidden", "Range validation requires library read access");
        if (input.range && input.range.bookId !== input.bookId)
          throw pluginObjectAccessDenied("annotations.commands.createHighlight");
        return scopedCommand(
          input.bookId,
          "annotations.commands.createHighlight",
          (signal) => rawCommands.createHighlight(input, signal),
          undefined,
          true,
          (value) => objectAccess.assertReturnedBook(value.bookId, "annotations.commands.createHighlight"),
        );
      }),
      createNote: restricted.command(async (input) => {
        if (input.range !== undefined && !domain.library)
          throw new AppError("annotations/forbidden", "Range validation requires library read access");
        if (input.range && input.range.bookId !== input.bookId)
          throw pluginObjectAccessDenied("annotations.commands.createNote");
        return scopedCommand(
          input.bookId,
          "annotations.commands.createNote",
          (signal) => rawCommands.createNote(input, signal),
          undefined,
          true,
          (value) => objectAccess.assertReturnedBook(value.bookId, "annotations.commands.createNote"),
        );
      }),
    });
    ctx.domains.annotations = restrictSurface<PluginAnnotationsDomain>(lifecycle, "domains.annotations", {
      queries: {
        inspect: restricted.read(async (annotationId) => {
          lifecycle.assertActive("annotations.queries.inspect");
          const snapshot = await lifecycle.read("annotations.queries.inspect", () => rawQueries.inspect(annotationId));
          verifyAnnotation("annotations.queries.inspect")(snapshot);
          return snapshot;
        }),
        page: restricted.read(async (input) => {
          const bookId = input?.bookId;
          if (!bookId) throw pluginObjectAccessDenied("annotations.queries.page");
          return scopedRead(
            bookId,
            "annotations.queries.page",
            () => rawQueries.page(input),
            undefined,
            verifyPage("annotations.queries.page"),
          );
        }),
        get: restricted.read(async (annotationId) => {
          lifecycle.assertActive("annotations.queries.get");
          const item = await lifecycle.read("annotations.queries.get", () => rawQueries.get(annotationId));
          verifyAnnotation("annotations.queries.get")(item);
          return item;
        }),
        list: restricted.read(async (filter) => {
          const bookId = filter?.bookId;
          if (!bookId) throw pluginObjectAccessDenied("annotations.queries.list");
          return scopedRead(
            bookId,
            "annotations.queries.list",
            () => rawQueries.list(filter),
            undefined,
            (items) => {
              for (const item of items) objectAccess.assertReturnedBook(item.bookId, "annotations.queries.list");
            },
          );
        }),
      },
      events: {
        subscribe: restricted.deny,
        observe: restricted.observe((query, handler) => {
          if (query.kind !== "page" || !query.query?.bookId)
            throw pluginObjectAccessDenied("annotations.events.observe");
          const bookId = query.query.bookId;
          objectAccess.assertBook(bookId, "annotations.events.observe");
          return () => ({
            dispose: annotations.events.observe(query, (event) => {
              try {
                objectAccess.assertBook(bookId, "annotations.events.observe");
                if (event.status === "ready" && event.result.kind === "page")
                  verifyPage("annotations.events.observe")(event.result.page);
              } catch (error) {
                log.debug("annotation observation outside book grant", error);
                return;
              }
              return handler(event);
            }),
          });
        }),
      },
      commands: annotations.commands ? commandPolicy(annotations.commands) : restricted.absent,
    });
  }
}
