import { readerPanels } from "../../../../services/reader-panels";
import { readerFocus } from "../../../../services/reader-focus";
import { readerReferencePreview } from "../../../../services/reader-reference-preview";
import { readerImage } from "../../../../services/reader-image";
import { readerImageOpen } from "../../../../services/reader-image-open";
import { readBookImage } from "../../../library";
import type { PluginContext } from "../../lib/plugin-types";
import { createLogger } from "../../../../platform/logger";
import type { PluginActorKit } from "./kit";

const log = createLogger("plugins");

/** Reader panels, focus, images and reference previews. */
export function installReaderUi(
  kit: PluginActorKit,
  ctx: PluginContext,
  reading: NonNullable<PluginActorKit["domain"]["reading"]>,
): void {
  const {
    lifecycle,
    currentBook,
    objectAccess,
    scopedRead,
    scopedCurrentRead,
    scopedCurrentCommand,
    referencePreviewOwner,
    operationActor,
    domain,
    track,
  } = kit;
  ctx.services.ui.reader = {
    image: {
      ...(reading.commands && domain.library
        ? {
            open: (
              query: import("@read-aware/core").BookImageQuery,
              guard?: import("@read-aware/core").ReadingSessionGuard,
            ) => {
              lifecycle.assertActive("services.ui.reader.image.open");
              return lifecycle.read("services.ui.reader.image.open", () =>
                readerImageOpen.open(
                  query,
                  (input, signal) => readBookImage(input, signal),
                  lifecycle.signal,
                  guard,
                  operationActor,
                ),
              );
            },
          }
        : {}),
      snapshot: async () => {
        lifecycle.assertActive("services.ui.reader.image.snapshot");
        return readerImage.snapshot();
      },
      observe: (handler) => track(() => ({ dispose: readerImage.observe(handler, operationActor) })),
      ...(reading.commands
        ? {
            control: (request: import("@read-aware/core").ReaderImageRequest) => {
              lifecycle.assertActive("services.ui.reader.image.control");
              return lifecycle.read("services.ui.reader.image.control", () =>
                readerImage.control(request, lifecycle.signal, operationActor),
              );
            },
          }
        : {}),
    },
    snapshot: async () => {
      lifecycle.assertActive("services.ui.reader.snapshot");
      return readerPanels.snapshot();
    },
    observe: (handler) => track(() => ({ dispose: readerPanels.observe(handler, operationActor) })),
    ...(reading.commands
      ? {
          setPanel: (
            panel: import("@read-aware/core").ReaderPanel,
            open: boolean,
            guard?: import("@read-aware/core").ReadingSessionGuard,
          ) => {
            lifecycle.assertActive("services.ui.reader.setPanel");
            return readerPanels.setPanel(panel, open, lifecycle.signal, guard, operationActor);
          },
          setWidth: (
            panel: import("@read-aware/core").ResizableReaderPanel,
            width: number,
            guard?: import("@read-aware/core").ReadingSessionGuard,
          ) => {
            lifecycle.assertActive("services.ui.reader.setWidth");
            return readerPanels.setWidth(panel, width, lifecycle.signal, guard, operationActor);
          },
          focus: (
            target: import("@read-aware/core").ReaderFocusTarget,
            guard?: import("@read-aware/core").ReadingSessionGuard,
          ) => {
            lifecycle.assertActive("services.ui.reader.focus");
            return readerFocus.focus(target, lifecycle.signal, guard, operationActor);
          },
        }
      : {}),
    ...(reading.commands && domain.library
      ? {
          previewReference: (
            query: import("@read-aware/core").BookReferenceQuery,
            guard?: import("@read-aware/core").ReadingSessionGuard,
          ) => {
            lifecycle.assertActive("services.ui.reader.previewReference");
            return lifecycle.read("reader.previewReference", () =>
              readerReferencePreview.open(
                referencePreviewOwner,
                query,
                (input, signal) => domain.library!.queries.books.readReference(input, signal),
                lifecycle.signal,
                guard,
              ),
            );
          },
          closeReferencePreview: (id: string) => {
            lifecycle.assertActive("services.ui.reader.closeReferencePreview");
            return lifecycle.read("reader.closeReferencePreview", () =>
              readerReferencePreview.close(referencePreviewOwner, id, lifecycle.signal),
            );
          },
        }
      : {}),
  };
  if (objectAccess.restricted) {
    const rawReader = ctx.services.ui.reader;
    if (rawReader) {
      const rawImage = rawReader.image;
      ctx.services.ui.reader = {
        image: rawImage
          ? {
              snapshot: async () => {
                const value = await scopedCurrentRead("services.ui.reader.image.snapshot", async () =>
                  rawImage.snapshot(),
                );
                if (value) objectAccess.assertReturnedBook(value.bookId, "services.ui.reader.image.snapshot");
                return value;
              },
              observe: (handler) => {
                objectAccess.assertBook(currentBook().bookId ?? "", "services.ui.reader.image.observe");
                return track(() =>
                  rawImage.observe((value, source) => {
                    try {
                      if (value) objectAccess.assertReturnedBook(value.bookId, "services.ui.reader.image.observe");
                    } catch (error) {
                      log.debug("reader image outside book grant", error);
                      return;
                    }
                    return handler(value, source);
                  }),
                );
              },
              ...(rawImage.control
                ? {
                    control: (request: import("@read-aware/core").ReaderImageRequest) =>
                      scopedCurrentCommand(
                        "services.ui.reader.image.control",
                        (signal) => readerImage.control(request, signal, operationActor),
                        undefined,
                        true,
                        (value) => {
                          if (value.status === "updated")
                            objectAccess.assertReturnedBook(value.snapshot.bookId, "services.ui.reader.image.control");
                        },
                      ),
                  }
                : {}),
              ...(rawImage.open
                ? {
                    open: (
                      query: import("@read-aware/core").BookImageQuery,
                      guard?: import("@read-aware/core").ReadingSessionGuard,
                    ) =>
                      scopedRead(
                        query.image.bookId,
                        "services.ui.reader.image.open",
                        (signal) =>
                          readerImageOpen.open(
                            query,
                            (input, readSignal) => readBookImage(input, readSignal),
                            signal,
                            guard,
                            operationActor,
                          ),
                        undefined,
                        (value) => {
                          if (value.status === "opened")
                            objectAccess.assertReturnedBook(value.snapshot.bookId, "services.ui.reader.image.open");
                        },
                      ),
                  }
                : {}),
            }
          : undefined,
        snapshot: async () => {
          const value = await scopedCurrentRead("services.ui.reader.snapshot", async () => rawReader.snapshot());
          if (value) objectAccess.assertReturnedBook(value.bookId, "services.ui.reader.snapshot");
          return value;
        },
        observe: (handler) => {
          objectAccess.assertBook(currentBook().bookId ?? "", "services.ui.reader.observe");
          return track(() =>
            rawReader.observe((value, source) => {
              try {
                if (value) objectAccess.assertReturnedBook(value.bookId, "services.ui.reader.observe");
              } catch (error) {
                log.debug("reader panels outside book grant", error);
                return;
              }
              return handler(value, source);
            }),
          );
        },
        ...(rawReader.setPanel
          ? {
              setPanel: (
                panel: import("@read-aware/core").ReaderPanel,
                open: boolean,
                guard?: import("@read-aware/core").ReadingSessionGuard,
              ) =>
                scopedCurrentCommand(
                  "services.ui.reader.setPanel",
                  (signal) => readerPanels.setPanel(panel, open, signal, guard, operationActor),
                  undefined,
                  true,
                  (value) => objectAccess.assertReturnedBook(value.snapshot.bookId, "services.ui.reader.setPanel"),
                ),
            }
          : {}),
        ...(rawReader.setWidth
          ? {
              setWidth: (
                panel: import("@read-aware/core").ResizableReaderPanel,
                width: number,
                guard?: import("@read-aware/core").ReadingSessionGuard,
              ) =>
                scopedCurrentCommand(
                  "services.ui.reader.setWidth",
                  (signal) => readerPanels.setWidth(panel, width, signal, guard, operationActor),
                  undefined,
                  true,
                  (value) => objectAccess.assertReturnedBook(value.snapshot.bookId, "services.ui.reader.setWidth"),
                ),
            }
          : {}),
        ...(rawReader.focus
          ? {
              focus: (
                target: import("@read-aware/core").ReaderFocusTarget,
                guard?: import("@read-aware/core").ReadingSessionGuard,
              ) =>
                scopedCurrentCommand(
                  "services.ui.reader.focus",
                  (signal) => readerFocus.focus(target, signal, guard, operationActor),
                  undefined,
                  true,
                  (value) => objectAccess.assertReturnedBook(value.bookId, "services.ui.reader.focus"),
                ),
            }
          : {}),
        ...(rawReader.previewReference && domain.library
          ? {
              previewReference: (
                query: import("@read-aware/core").BookReferenceQuery,
                guard?: import("@read-aware/core").ReadingSessionGuard,
              ) =>
                scopedRead(
                  query.reference.bookId,
                  "services.ui.reader.previewReference",
                  (signal) =>
                    readerReferencePreview.open(
                      referencePreviewOwner,
                      query,
                      (input, readSignal) => domain.library!.queries.books.readReference(input, readSignal),
                      signal,
                      guard,
                    ),
                  undefined,
                  (value) => {
                    objectAccess.assertReturnedBook(
                      value.preview.reference.bookId,
                      "services.ui.reader.previewReference",
                    );
                    if (value.preview.location)
                      objectAccess.assertReturnedBook(
                        value.preview.location.bookId,
                        "services.ui.reader.previewReference",
                      );
                  },
                ),
            }
          : {}),
        ...(rawReader.closeReferencePreview
          ? {
              closeReferencePreview: (id: string) =>
                scopedCurrentCommand(
                  "services.ui.reader.closeReferencePreview",
                  (signal) => readerReferencePreview.close(referencePreviewOwner, id, signal),
                  undefined,
                  true,
                ),
            }
          : {}),
      };
    }
  }
}
