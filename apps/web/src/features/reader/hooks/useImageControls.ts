import { useLayoutEffect, useRef, useState } from "react";
import { errorCode } from "@read-aware/core";
import { readerImage, type ReaderImageService } from "../../../services/reader-image";
import type { useZoomPan } from "./useZoomPan";

export function useImageControls(zoom: ReturnType<typeof useZoomPan>,
  session: { bookId: string; sessionId: string } | undefined, onClose: () => void,
  service: ReaderImageService = readerImage) {
  const id = useRef(crypto.randomUUID());
  const current = useRef({ zoom, onClose });
  current.current = { zoom, onClose };
  const [token, setToken] = useState(0);
  const binding = useRef<ReturnType<ReaderImageService["bind"]> | null>(null);
  useLayoutEffect(() => {
    if (!session) return;
    let bound: ReturnType<ReaderImageService["bind"]>;
    try { bound = service.bind({ ...session, id: id.current }, {
      close: () => current.current.onClose(),
      apply: (request, nextToken) => {
        const view = current.current.zoom;
        if (request.action === "zoom-in") view.zoomIn();
        else if (request.action === "zoom-out") view.zoomOut();
        else if (request.action === "rotate") view.rotateRight();
        else if (request.action === "reset") view.reset();
        else if (request.action === "pan") view.pan(request.dx, request.dy);
        setToken(nextToken);
      },
    }, current.current.zoom.snapshot()); }
    catch (error) {
      if (errorCode(error) !== "reader/superseded") throw error;
      current.current.onClose();
      return;
    }
    binding.current = bound;
    const stage = current.current.zoom.stageRef.current;
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      bound.publish(current.current.zoom.snapshot(), 0);
    });
    if (stage) resize?.observe(stage);
    return () => { resize?.disconnect(); bound.dispose(); if (binding.current === bound) binding.current = null; };
  }, [service, session?.bookId, session?.sessionId]);
  useLayoutEffect(() => { binding.current?.publish(zoom.snapshot(), token); });
}
