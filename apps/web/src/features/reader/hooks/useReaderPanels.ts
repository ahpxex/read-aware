import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAtomValue, useStore } from "jotai";
import { AppError, errorCode, type ReaderPanel, type ReaderPanelsView } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { describeError } from "../../../i18n";
import { IpcError } from "../../../platform/ipc";
import { createLogger } from "../../../platform/logger";
import {
  actorFromEvent,
  causalActor,
  copyEventCause,
  eventCause,
  type DomainActor,
} from "../../../platform/domain-actor";
import { readingRuntime } from "../../../domain/reading-runtime";
import { readerPanels } from "../../../services/reader-panels";
import {
  getReaderPanelLayout,
  readerPanelLayoutStore,
  updateReaderPanelLayout,
  readerPanelRenderActor,
} from "../lib/reader-panel-layout";
import { readerPanelSizesAtom, updateReaderPanelWidth } from "../lib/reader-panel-sizes";
import { askAiRequestAtom } from "../../ai/state/chat-intent";
import { readerPanelAcknowledgementsAtom, readerPanelIntentAtom, type ReaderPanelIntent } from "../state/panel-intent";

const log = createLogger("reader-panels");

function usePanelIntent(
  bookId: string,
  channel: "panel" | "ask",
  intent: ReaderPanelIntent | null,
  report: (error: unknown) => void,
) {
  const store = useStore();
  const handled = useRef<string | null>(null);
  const id = intent?.id,
    targetBook = intent?.bookId,
    panel = intent?.panel;
  const origin = useMemo(() => (intent && eventCause(intent) ? actorFromEvent(intent) : causalActor("user")), [intent]);
  useEffect(() => {
    if (
      !id ||
      !panel ||
      targetBook !== bookId ||
      handled.current === id ||
      store.get(readerPanelAcknowledgementsAtom)[channel] === id
    )
      return;
    const controller = new AbortController();
    let dispatched = false,
      settled = false;
    const stop = readerPanels.observe((snapshot) => {
      if (dispatched || !snapshot || snapshot.bookId !== bookId) return;
      dispatched = true;
      handled.current = id;
      void readerPanels
        .setPanel(panel, true, controller.signal, snapshot, origin)
        .then(() => {
          store.set(readerPanelAcknowledgementsAtom, (previous) => ({ ...previous, [channel]: id }));
        })
        .catch((error) => {
          if (!controller.signal.aborted) report(error);
        })
        .finally(() => {
          settled = true;
        });
    });
    return () => {
      stop();
      // Effect replay may retire an in-flight opening before its first commit.
      if (dispatched && !settled && handled.current === id) handled.current = null;
      controller.abort(new AppError("reader/superseded", "Reader panel intent retired"));
    };
  }, [bookId, channel, id, targetBook, panel, origin, report, store]);
}

type TransientPanels = {
  bookId: string;
  toc: boolean;
  chat: boolean;
  annotations: boolean;
  appearance: boolean;
  origin: DomainActor;
};
const closedTransient = (bookId: string, origin: DomainActor): TransientPanels => ({
  bookId,
  toc: false,
  chat: false,
  annotations: false,
  appearance: false,
  origin,
});

/** Native controls and external actors use the same bound presentation adapter.
 *
 * Docked (desktop/tablet) layout persists the TOC and chat docks per book so a
 * book reopens as it was left. Exclusive (phone) layout shows them as
 * full-screen sheets over the page, where a restored or remembered sheet is an
 * obstacle rather than a convenience: there they are transient like the
 * annotations/appearance popovers, close whenever the chrome hides, and never
 * touch the persisted docked layout. */
export function useReaderPanels(
  bookId: string,
  visible: boolean,
  exclusive: boolean,
  controlsOrigin: DomainActor = "system",
  layoutOrigin?: DomainActor,
) {
  const sizes = useAtomValue(readerPanelSizesAtom);
  const layoutState = useSyncExternalStore(readerPanelLayoutStore.subscribe, readerPanelLayoutStore.getRenderSnapshot);
  const layout = useMemo(() => getReaderPanelLayout(bookId, layoutState.raw), [bookId, layoutState]);
  const [transient, setTransient] = useState(() => closedTransient(bookId, causalActor("system")));
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- a layout flip mints a fresh environment actor: each flip is its own cause
  const environmentOrigin = useMemo(() => causalActor(layoutOrigin ?? "system"), [exclusive, layoutOrigin]);
  const [token, setToken] = useState(0);
  const [chatFocus, setChatFocus] = useState(() => ({ id: 0, origin: causalActor("system") }));
  const { toast } = useToast();
  const binding = useRef<ReturnType<typeof readerPanels.bind> | null>(null);
  const boundBook = useRef<string | null>(null);
  const committed = useRef<ReaderPanelsView | null>(null);
  const environment = useRef({ exclusive });
  const currentTransient = visible && transient.bookId === bookId ? transient : null;
  const selected = {
    toc: exclusive ? currentTransient?.toc === true : layout.tocOpen,
    chat: exclusive ? currentTransient?.chat === true : layout.notesOpen,
    annotations: currentTransient?.annotations === true,
    appearance: currentTransient?.appearance === true,
  };
  useLayoutEffect(() => {
    environment.current = { exclusive };
    const view: ReaderPanelsView = {
      controlsVisible: visible,
      sizes,
      layout: exclusive ? "exclusive" : "docked",
      panels: {
        toc: { open: selected.toc, visible: visible && selected.toc },
        chat: { open: selected.chat, visible: visible && selected.chat },
        annotations: { open: selected.annotations, visible: selected.annotations },
        appearance: { open: selected.appearance, visible: selected.appearance },
      },
    };
    const origin = readerPanelRenderActor(committed.current, view, {
      layout: layoutState.origin,
      sizes: actorFromEvent(sizes),
      transient: transient.origin,
      controls: controlsOrigin,
      environment: environmentOrigin,
    });
    committed.current = view;
    if (boundBook.current === bookId) binding.current?.publish(view, token, origin);
  });
  useEffect(() => {
    if (!visible) setTransient(closedTransient(bookId, causalActor(controlsOrigin)));
  }, [visible, bookId, controlsOrigin]);
  // A breakpoint change swaps which store owns the TOC/chat selection. Drop the
  // sheets of the layout being left so they cannot resurface on the way back.
  const publishedLayout = useRef(exclusive);
  useEffect(() => {
    if (publishedLayout.current === exclusive) return;
    publishedLayout.current = exclusive;
    setTransient((previous) =>
      previous.toc || previous.chat ? { ...previous, toc: false, chat: false, origin: environmentOrigin } : previous,
    );
  }, [exclusive, environmentOrigin]);
  useEffect(() => {
    let sessionId: string | null = null;
    const stop = readingRuntime.observe((state) => {
      const id = state.status === "ready" && state.bookId === bookId ? state.sessionId : null;
      if (id === sessionId) return;
      sessionId = id;
      binding.current?.dispose(actorFromEvent(state));
      binding.current = null;
      boundBook.current = null;
      if (!id || !committed.current) return;
      boundBook.current = bookId;
      binding.current = readerPanels.bind(
        id,
        bookId,
        {
          applyWidth: updateReaderPanelWidth,
          apply: async (panel, open, signal, origin) => {
            signal.throwIfAborted();
            const dock = panel === "toc" || panel === "chat";
            if (dock && !environment.current.exclusive) {
              const key = panel === "toc" ? "tocOpen" : "notesOpen";
              await updateReaderPanelLayout(bookId, (previous) => ({ ...previous, [key]: open }), signal, origin);
            } else
              setTransient((previous) =>
                signal.aborted
                  ? previous
                  : {
                      ...(previous.bookId === bookId ? previous : closedTransient(bookId, origin)),
                      // Phone panels each take the room between the bars (the sheets
                      // fill it, the bottom bar's drawer grows into it), so opening
                      // one closes whichever else is showing.
                      ...(open && environment.current.exclusive
                        ? { toc: false, chat: false, annotations: false, appearance: false }
                        : {}),
                      [panel]: open,
                      origin,
                    },
              );
            signal.throwIfAborted();
            if (panel === "chat" && open)
              setChatFocus((value) => (signal.aborted ? value : { id: value.id + 1, origin }));
          },
          requestCommit: setToken,
        },
        committed.current,
        actorFromEvent(state),
      );
    });
    return () => {
      stop();
      binding.current?.dispose();
      binding.current = null;
      boundBook.current = null;
    };
  }, [bookId]);
  const report = useCallback(
    (error: unknown) => {
      if (errorCode(error) === "reader/superseded") return; // A newer user intent or retired reader owns the surface.
      log.warn("Reader panel change failed", error);
      // Native KV failures already have one global localized write-failure toast.
      if (!(error instanceof IpcError && error.command === "set_kv"))
        toast({ variant: "destructive", description: describeError(error).body });
    },
    [toast],
  );
  /** Resolves true once the change committed. The service runs one intent at
   * a time (a newer one supersedes a pending one), so a caller changing two
   * panels awaits the first before issuing the second. Failures are reported
   * here and resolve false. */
  const changePanel = useCallback(
    (panel: ReaderPanel, open: boolean): Promise<boolean> => {
      const snapshot = readerPanels.snapshot();
      return readerPanels.setPanel(panel, open, undefined, { bookId, sessionId: snapshot?.sessionId }).then(
        () => true,
        (error: unknown) => {
          report(error);
          return false;
        },
      );
    },
    [bookId, report],
  );
  const setPanel = useCallback(
    (panel: ReaderPanel, open: boolean) => {
      void changePanel(panel, open);
    },
    [changePanel],
  );
  const panelIntent = useAtomValue(readerPanelIntentAtom);
  const askAiRequest = useAtomValue(askAiRequestAtom);
  const askPanelIntent = useMemo(
    () =>
      askAiRequest
        ? copyEventCause(askAiRequest, { id: askAiRequest.id, bookId: askAiRequest.bookId, panel: "chat" as const })
        : null,
    [askAiRequest],
  );
  // One consumer owns both revealing chrome and opening the target. A second
  // reveal in useReaderSession would supersede this service's pending command.
  usePanelIntent(bookId, "panel", panelIntent, report);
  usePanelIntent(bookId, "ask", askPanelIntent, report);
  return {
    ...selected,
    chatFocusRequestId: chatFocus.id,
    chatFocusOrigin: chatFocus.origin,
    setPanel,
    changePanel,
  };
}
