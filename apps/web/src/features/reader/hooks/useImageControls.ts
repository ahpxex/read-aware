import { useLayoutEffect, useRef, useState } from "react";
import { errorCode } from "@read-aware/core";
import { readerImage, type ReaderImageService } from "../../../services/reader-image";
import type { useZoomPan } from "./useZoomPan";
import { causalActor, type DomainActor } from "../../../platform/domain-actor";
import type { ImageViewLifetime } from "./useImageViewer";

export function useImageControls(
  zoom: ReturnType<typeof useZoomPan>,
  session: { bookId: string; sessionId: string } | undefined,
  onClose: (origin?: DomainActor) => void,
  service: ReaderImageService = readerImage,
  viewerId?: string,
  lifetime?: ImageViewLifetime,
) {
  const id = useRef(crypto.randomUUID());
  const owned = useRef<ImageViewLifetime>({ opening: zoom.origin });
  const source = lifetime ?? owned.current;
  const current = useRef({ zoom, onClose });
  current.current = { zoom, onClose };
  const [token, setToken] = useState(0);
  const binding = useRef<ReturnType<ReaderImageService["bind"]> | null>(null);
  // The binding follows the session's identity, not a new object for the same session.
  const bookId = session?.bookId,
    sessionId = session?.sessionId;
  useLayoutEffect(() => {
    if (bookId === undefined || sessionId === undefined) return;
    let bound: ReturnType<ReaderImageService["bind"]>;
    try {
      bound = service.bind(
        { bookId, sessionId, id: viewerId ?? id.current },
        {
          close: (origin) => {
            source.closedBy ??= origin;
            current.current.onClose(origin);
          },
          apply: (request, nextToken, origin) => {
            const view = current.current.zoom;
            if (request.action === "zoom-in") view.zoomIn(origin);
            else if (request.action === "zoom-out") view.zoomOut(origin);
            else if (request.action === "rotate") view.rotateRight(origin);
            else if (request.action === "reset") view.reset(origin);
            else if (request.action === "pan") view.pan(request.dx, request.dy, origin);
            setToken(nextToken);
          },
        },
        current.current.zoom.snapshot(),
        source.opening,
      );
    } catch (error) {
      if (errorCode(error) !== "reader/superseded") throw error;
      current.current.onClose();
      return;
    }
    binding.current = bound;
    const stage = current.current.zoom.stageRef.current;
    let width = stage?.clientWidth,
      height = stage?.clientHeight;
    // A stage resize republishes the transform at once, as the system's change.
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (!stage || binding.current !== bound || source.closedBy) return;
            if (stage.clientWidth === width && stage.clientHeight === height) return;
            width = stage.clientWidth;
            height = stage.clientHeight;
            bound.publish(current.current.zoom.snapshot(), 0, causalActor("system"));
          });
    if (stage) resize?.observe(stage);
    return () => {
      resize?.disconnect();
      bound.dispose(source.closedBy ?? source.opening);
      if (binding.current === bound) binding.current = null;
    };
  }, [service, bookId, sessionId, viewerId, source]);
  // Parent renders do not make a new zoom intent. A geometry-only change is
  // published by its resize sample, not under the previous pan/zoom's source.
  const { snapshot: zoomSnapshot, origin: zoomOrigin } = zoom;
  useLayoutEffect(() => {
    binding.current?.publish(zoomSnapshot(), token, zoomOrigin);
  }, [zoomSnapshot, token, zoomOrigin]);
}
