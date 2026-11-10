/**
 * Zoom for fixed-layout books (PDF, comics): keeps the renderer at the book's
 * remembered zoom, and turns the reader's zoom input into it — the zoom keys,
 * a trackpad pinch (WebKit gesture events, or Chromium's ctrl+wheel), a mouse
 * wheel with the zoom chord, and a two-finger pinch on touch screens.
 *
 * Continuous input zooms the renderer live (it re-presents the pages at every
 * step and rasters once they hold still) and is remembered for the book when
 * the gesture ends. Discrete input zooms the renderer at once and is
 * remembered straight away; a change made elsewhere (the fit control, another
 * window) reaches the renderer through the book's memory.
 *
 * It also keeps where on the page the reader was looking (`viewFocus`), so a
 * zoomed page reopens on the same passage rather than at its corner, and
 * whether that view is locked, so page turns keep showing the same part of
 * every page (`setViewLocked`; paged flows only).
 */
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useAtomValue } from "jotai";
import { fixedLayoutViewsAtom } from "../../../state/ui";
import type { DomainActor } from "../../../platform/domain-actor";
import { createLogger } from "../../../platform/logger";
import type { FoliateRenderer, FoliateView } from "../lib/foliate-engine";
import { readingRenderContext } from "../lib/reading-render-context";
import { createZoomFeedback, type ZoomFeedback } from "../lib/zoom-feedback";
import { saveFixedLayoutFocus, saveFixedLayoutLock, saveFixedLayoutZoom } from "../../../domain/reading-zoom";
import type { ViewFocus } from "../../../../foliate-js/src/fixed-layout";
import {
  DEFAULT_FIXED_LAYOUT_ZOOM,
  clampZoomFactor,
  sameFixedLayoutZoom,
  stepZoomFactor,
  wheelZoomRatio,
  type FixedLayoutZoom,
} from "../lib/fixed-layout-zoom";

const log = createLogger("reader-zoom");

/** A ctrl+wheel stream has no end event; it is committed once it pauses this long. */
const WHEEL_COMMIT_MS = 250;
/** A keyboard pan moves a zoomed page by this share of the viewport. */
const KEY_PAN_SHARE = 0.85;
/** Where the reader is looking is remembered once the view has rested this long. */
const FOCUS_SAVE_MS = 600;

type ZoomAnchor = { x: number; y: number };
type ZoomRenderer = Extract<FoliateRenderer, { setZoom: unknown }>;
/** WebKit's trackpad pinch (and iOS's two-finger gesture); not in the DOM typings. */
type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };

type Options = {
  bookId: string | undefined;
  viewRef: RefObject<FoliateView | null>;
  isFixedLayoutRef: RefObject<boolean>;
  readerRootRef: RefObject<HTMLElement | null>;
  /** The book viewport; pinches over overlays drawn beside it stay theirs. */
  viewportRef: RefObject<HTMLElement | null>;
};

export type FixedLayoutZoomInput = {
  /** Every zoom change, for the transient percentage indicator. */
  feedback: ZoomFeedback;
  /** Set the book's zoom on a renderer before its first page is shown. */
  prepareRenderer: (renderer: FoliateRenderer | undefined, context: object) => void;
  /**
   * Once the reading position is restored, bring back where on that page the
   * reader was looking, and from then on keep track of it. The returned
   * function stops tracking, remembering the latest place.
   */
  restoreFocus: (renderer: FoliateRenderer | undefined, following?: () => boolean) => () => void;
  /** A ctrl+wheel in the reader; true when it zoomed (the caller stops routing it). */
  handleZoomWheel: (event: WheelEvent) => boolean;
  /** Pan a zoomed paged spread by a wheel event; true when the spread moved. */
  panByWheel: (event: WheelEvent) => boolean;
  /** Pan a zoomed paged spread a screenful by keyboard; true when it moved. */
  panByKey: (axis: "x" | "y", direction: 1 | -1) => boolean;
  /** Which edges a zoomed paged spread rests against; all of them when it fits. */
  panEdges: () => { left: boolean; right: boolean; top: boolean; bottom: boolean };
  /** Pinch listeners for a section document, for as long as it lives. */
  attachDocument: (doc: Document) => void;
  stepZoom: (direction: 1 | -1, origin?: DomainActor) => void;
  /** Back to the fit, which also releases a locked view. */
  resetZoom: (origin?: DomainActor) => void;
  /** The book's zoomed view is locked for page turns. */
  locked: boolean;
  toggleLock: (origin?: DomainActor) => void;
};

const ALL_EDGES = { left: true, right: true, top: true, bottom: true };

export function useFixedLayoutZoom({
  bookId,
  viewRef,
  isFixedLayoutRef,
  readerRootRef,
  viewportRef,
}: Options): FixedLayoutZoomInput {
  const stored = useAtomValue(fixedLayoutViewsAtom)[bookId ?? ""] ?? DEFAULT_FIXED_LAYOUT_ZOOM;
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const feedback = useMemo(() => createZoomFeedback(), []);

  /** The open fixed-layout renderer, when there is one. */
  const zoomRenderer = useCallback((): ZoomRenderer | null => {
    const renderer = viewRef.current?.renderer;
    return isFixedLayoutRef.current && renderer && "setZoom" in renderer ? renderer : null;
  }, [viewRef, isFixedLayoutRef]);

  const prepareRenderer = useCallback(
    (renderer: FoliateRenderer | undefined, context: object) => {
      if (!renderer || !("setZoom" in renderer)) return;
      const { fit, factor, locked } = storedRef.current;
      renderer.setZoom({ fit, factor }, { context });
      renderer.setViewLocked(!!locked);
      // Known to the reset control, without announcing a change.
      feedback.publish(factor, { announce: false });
    },
    [feedback],
  );

  // The book's memory changed somewhere else — the appearance controls, or
  // another window — so the pages follow. Input handled here applies to the
  // renderer itself before remembering (see `applyAndRemember`), so this
  // finds it already in place.
  useEffect(() => {
    const renderer = zoomRenderer();
    if (!renderer) return;
    if (renderer.viewLocked !== !!stored.locked) renderer.setViewLocked(!!stored.locked);
    if (sameFixedLayoutZoom(renderer.zoom, stored)) return;
    renderer.setZoom({ fit: stored.fit, factor: stored.factor }, { context: readingRenderContext("user") });
    feedback.publish(stored.factor);
  }, [feedback, stored, zoomRenderer]);

  const remember = useCallback(
    (zoom: FixedLayoutZoom, origin: DomainActor = "user") => {
      if (!bookId) return;
      try {
        saveFixedLayoutZoom(bookId, zoom, origin);
      } catch (error) {
        // The KV queue reports failed writes itself; a throw here is a bug.
        log.error("Could not remember the book's zoom", error);
      }
    },
    [bookId],
  );

  /**
   * Zoom the renderer now, then remember it. Synchronous on purpose: the
   * next key press steps from the zoom this one set, not from whatever the
   * store has propagated by then — two quick presses are two steps.
   */
  const applyAndRemember = useCallback(
    (renderer: ZoomRenderer, zoom: FixedLayoutZoom, anchor?: ZoomAnchor, origin: DomainActor = "user") => {
      renderer.setZoom(zoom, { anchor, context: readingRenderContext(origin) });
      feedback.publish(zoom.factor);
      remember(zoom, origin);
    },
    [feedback, remember],
  );

  // ---- Continuous zoom -----------------------------------------------------

  // Pinch state shared by every surface: one gesture at a time. `touch` is
  // set while two fingers pinch, so the gesture events iOS fires alongside
  // the same touches are not counted twice.
  const pinch = useRef<{ kind: "gesture" | "touch"; startFactor: number; startDistance: number } | null>(null);
  const wheelCommitTimer = useRef<number | null>(null);
  const lastAnchor = useRef<ZoomAnchor | undefined>(undefined);

  const zoomLive = useCallback(
    (ratio: number, anchor: ZoomAnchor | undefined) => {
      const renderer = zoomRenderer();
      if (!renderer || !Number.isFinite(ratio) || ratio <= 0) return;
      const { fit, factor } = renderer.zoom;
      lastAnchor.current = anchor;
      renderer.setZoom(
        { fit, factor: clampZoomFactor(factor * ratio) },
        { anchor, live: true, context: readingRenderContext("user") },
      );
      feedback.publish(renderer.zoom.factor);
    },
    [feedback, zoomRenderer],
  );

  /** End a continuous zoom: raster it and remember it, exactly where the fingers left it. */
  const commitLive = useCallback(() => {
    if (wheelCommitTimer.current != null) window.clearTimeout(wheelCommitTimer.current);
    wheelCommitTimer.current = null;
    const renderer = zoomRenderer();
    if (!renderer) return;
    applyAndRemember(renderer, renderer.zoom, lastAnchor.current);
  }, [applyAndRemember, zoomRenderer]);

  useEffect(
    () => () => {
      if (wheelCommitTimer.current != null) window.clearTimeout(wheelCommitTimer.current);
    },
    [],
  );

  const handleZoomWheel = useCallback(
    (event: WheelEvent): boolean => {
      if (!event.ctrlKey || !zoomRenderer()) return false;
      if (event.cancelable) event.preventDefault();
      // One pinch, one source: while WebKit's gesture events drive a pinch,
      // a ctrl+wheel stream for the same fingers would zoom it twice over.
      if (pinch.current) return true;
      zoomLive(wheelZoomRatio(event.deltaY, event.deltaMode), topLevelPoint(event));
      if (wheelCommitTimer.current != null) window.clearTimeout(wheelCommitTimer.current);
      wheelCommitTimer.current = window.setTimeout(commitLive, WHEEL_COMMIT_MS);
      return true;
    },
    [commitLive, zoomLive, zoomRenderer],
  );

  /** Pinch listeners on one surface; the returned function removes them. */
  const listen = useCallback(
    (target: Document | HTMLElement, guard?: (event: Event) => boolean) => {
      const controller = new AbortController();
      const options = { passive: false, signal: controller.signal } as const;
      const on = <E extends Event>(type: string, handler: (event: E) => void) =>
        target.addEventListener(
          type,
          (event) => {
            if (!guard || guard(event)) handler(event as E);
          },
          options,
        );

      // WebKit's trackpad pinch: `scale` is cumulative from the start.
      on<GestureEvent>("gesturestart", (event) => {
        const renderer = zoomRenderer();
        if (!renderer) return;
        // Unclaimed, the webview would zoom the whole window.
        event.preventDefault();
        if (pinch.current?.kind === "touch") return;
        pinch.current = { kind: "gesture", startFactor: renderer.zoom.factor, startDistance: 1 };
      });
      on<GestureEvent>("gesturechange", (event) => {
        const renderer = zoomRenderer();
        if (!renderer) return;
        event.preventDefault();
        const state = pinch.current;
        if (state?.kind !== "gesture") return;
        zoomLive((state.startFactor * event.scale) / renderer.zoom.factor, topLevelPoint(event));
      });
      on<GestureEvent>("gestureend", (event) => {
        if (!zoomRenderer()) return;
        event.preventDefault();
        if (pinch.current?.kind !== "gesture") return;
        pinch.current = null;
        commitLive();
      });

      // Two fingers on a touch screen.
      on<TouchEvent>("touchstart", (event) => {
        const renderer = zoomRenderer();
        if (!renderer || event.touches.length !== 2) return;
        const [a, b] = [event.touches[0]!, event.touches[1]!];
        pinch.current = {
          kind: "touch",
          startFactor: renderer.zoom.factor,
          startDistance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        };
      });
      on<TouchEvent>("touchmove", (event) => {
        const renderer = zoomRenderer();
        const state = pinch.current;
        if (!renderer || state?.kind !== "touch" || event.touches.length !== 2) return;
        // Two fingers are a zoom, never a scroll or the webview's own zoom.
        if (event.cancelable) event.preventDefault();
        if (state.startDistance <= 0) return;
        const [a, b] = [event.touches[0]!, event.touches[1]!];
        const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const middle = topLevelPoint({
          clientX: (a.clientX + b.clientX) / 2,
          clientY: (a.clientY + b.clientY) / 2,
          target: event.target,
        });
        zoomLive((state.startFactor * distance) / state.startDistance / renderer.zoom.factor, middle);
      });
      const endTouch = (event: TouchEvent) => {
        if (pinch.current?.kind !== "touch" || event.touches.length >= 2) return;
        pinch.current = null;
        commitLive();
      };
      on<TouchEvent>("touchend", endTouch);
      on<TouchEvent>("touchcancel", endTouch);
      return () => controller.abort();
    },
    [commitLive, zoomLive, zoomRenderer],
  );

  const attachDocument = useCallback((doc: Document) => void listen(doc), [listen]);

  // The host area around the pages (a paged spread's margins, the gaps of a
  // stack) is part of the page to a pinch too.
  useEffect(() => {
    const root = readerRootRef.current;
    if (!root) return;
    return listen(root, (event) => {
      const target = event.target as Node | null;
      return target != null && !!viewportRef.current?.contains(target);
    });
  }, [listen, readerRootRef, viewportRef]);

  // ---- Discrete zoom and panning -------------------------------------------

  const stepZoom = useCallback(
    (direction: 1 | -1, origin: DomainActor = "user") => {
      const renderer = zoomRenderer();
      if (!renderer) return;
      applyAndRemember(
        renderer,
        { fit: renderer.zoom.fit, factor: stepZoomFactor(renderer.zoom.factor, direction) },
        undefined,
        origin,
      );
    },
    [applyAndRemember, zoomRenderer],
  );

  const rememberLock = useCallback(
    (locked: boolean, origin: DomainActor) => {
      if (!bookId) return;
      try {
        saveFixedLayoutLock(bookId, locked, origin);
      } catch (error) {
        // The KV queue reports failed writes itself; a throw here is a bug.
        log.error("Could not remember the book's view lock", error);
      }
    },
    [bookId],
  );

  const resetZoom = useCallback(
    (origin: DomainActor = "user") => {
      const renderer = zoomRenderer();
      if (!renderer) return;
      // At the fit there is nothing left to hold still.
      if (renderer.viewLocked) {
        renderer.setViewLocked(false);
        rememberLock(false, origin);
      }
      applyAndRemember(renderer, { fit: renderer.zoom.fit, factor: 1 }, undefined, origin);
    },
    [applyAndRemember, rememberLock, zoomRenderer],
  );

  const toggleLock = useCallback(
    (origin: DomainActor = "user") => {
      const renderer = zoomRenderer();
      if (!renderer) return;
      const locked = !renderer.viewLocked;
      renderer.setViewLocked(locked);
      rememberLock(locked, origin);
      // Up briefly with its lock showing — a key press has nothing else to show for it.
      feedback.publish(renderer.zoom.factor);
    },
    [feedback, rememberLock, zoomRenderer],
  );

  const panByWheel = useCallback(
    (event: WheelEvent): boolean => {
      const renderer = zoomRenderer();
      if (!renderer || renderer.scrolled) return false;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? renderer.clientHeight : 1;
      if (!renderer.panBy(event.deltaX * unit, event.deltaY * unit)) return false;
      if (event.cancelable) event.preventDefault();
      return true;
    },
    [zoomRenderer],
  );

  const panByKey = useCallback(
    (axis: "x" | "y", direction: 1 | -1): boolean => {
      const renderer = zoomRenderer();
      if (!renderer || renderer.scrolled) return false;
      return axis === "x"
        ? renderer.panBy(direction * renderer.clientWidth * KEY_PAN_SHARE, 0)
        : renderer.panBy(0, direction * renderer.clientHeight * KEY_PAN_SHARE);
    },
    [zoomRenderer],
  );

  // ---- Where on the page ---------------------------------------------------

  const restoreFocus = useCallback(
    /** `following`: whether a move is the reader's own (false while the reader only stands by). */
    (renderer: FoliateRenderer | undefined, following: () => boolean = () => true) => {
      if (!bookId || !renderer || !("showFocus" in renderer)) return () => {};
      const saved = storedRef.current.focus;
      if (saved) renderer.showFocus(saved);
      // Followed through scrolls (pans, zooms, a stack's scrolling) and page
      // turns (which need not scroll at all), and remembered once it rests.
      let latest: ViewFocus | null = null;
      let timer: number | null = null;
      const save = () => {
        timer = null;
        if (!latest) return;
        try {
          saveFixedLayoutFocus(bookId, latest, "user");
        } catch (error) {
          // The KV queue reports failed writes itself; a throw here is a bug.
          log.error("Could not remember where the book was being read", error);
        }
      };
      const observe = () => {
        // A standing reader re-lays itself out (a resize, a setting); that is
        // not somewhere the book was read.
        if (!following()) return;
        latest = renderer.viewFocus ?? latest;
        if (timer != null) window.clearTimeout(timer);
        timer = window.setTimeout(save, FOCUS_SAVE_MS);
      };
      renderer.addEventListener("scroll", observe, { passive: true });
      renderer.addEventListener("relocate", observe);
      return () => {
        renderer.removeEventListener("scroll", observe);
        renderer.removeEventListener("relocate", observe);
        if (timer != null) {
          window.clearTimeout(timer);
          save();
        }
      };
    },
    [bookId],
  );

  const panEdges = useCallback(() => {
    const renderer = zoomRenderer();
    return renderer && !renderer.scrolled ? renderer.panEdges : ALL_EDGES;
  }, [zoomRenderer]);

  return {
    feedback,
    prepareRenderer,
    restoreFocus,
    handleZoomWheel,
    panByWheel,
    panByKey,
    panEdges,
    attachDocument,
    stepZoom,
    resetZoom,
    locked: !!stored.locked,
    toggleLock,
  };
}

/**
 * An event's point in the reader window's coordinates. Section documents live
 * in iframes, whose events report points in the frame's own viewport; the
 * renderer anchors zooms in the window's.
 */
function topLevelPoint(event: { clientX: number; clientY: number; target: EventTarget | null }): ZoomAnchor {
  // By node type, not `instanceof`: a frame's nodes come from its own realm.
  const node = event.target as Node | null;
  const doc = node ? (node.nodeType === Node.DOCUMENT_NODE ? (node as Document) : node.ownerDocument) : null;
  const frame = doc && doc !== document ? doc.defaultView?.frameElement : null;
  if (!frame) return { x: event.clientX, y: event.clientY };
  const rect = frame.getBoundingClientRect();
  return { x: rect.left + event.clientX, y: rect.top + event.clientY };
}
