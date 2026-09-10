import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAtomValue, useStore } from "jotai";
import { AppError, errorCode, type ReaderPanel, type ReaderPanelsView } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { describeError } from "../../../i18n";
import { IpcError } from "../../../platform/ipc";
import { createLogger } from "../../../platform/logger";
import { readingRuntime } from "../../../domain/reading-runtime";
import { readerPanels } from "../../../services/reader-panels";
import { getReaderPanelLayout, readerPanelLayoutStore, updateReaderPanelLayout } from "../lib/reader-panel-layout";
import { readerPanelSizesAtom, updateReaderPanelWidth } from "../lib/reader-panel-sizes";
import { askAiRequestAtom } from "../../ai/state/chat-intent";
import { readerPanelAcknowledgementsAtom, readerPanelIntentAtom, type ReaderPanelIntent } from "../state/panel-intent";

const log = createLogger("reader-panels");

function usePanelIntent(bookId: string, channel: "panel" | "ask", intent: ReaderPanelIntent | null, report: (error: unknown) => void) {
  const store = useStore();
  const handled = useRef<string | null>(null);
  const id = intent?.id, targetBook = intent?.bookId, panel = intent?.panel;
  useEffect(() => {
    if (!id || !panel || targetBook !== bookId || handled.current === id || store.get(readerPanelAcknowledgementsAtom)[channel] === id) return;
    const controller = new AbortController();
    let dispatched = false, settled = false;
    const stop = readerPanels.observe(snapshot => {
      if (dispatched || !snapshot || snapshot.bookId !== bookId) return;
      dispatched = true; handled.current = id;
      void readerPanels.setPanel(panel, true, controller.signal, snapshot).then(() => {
        store.set(readerPanelAcknowledgementsAtom, previous => ({ ...previous, [channel]: id }));
      }).catch(error => {
        if (!controller.signal.aborted) report(error);
      }).finally(() => { settled = true; });
    });
    return () => {
      stop();
      // Effect replay may retire an in-flight opening before its first commit.
      if (dispatched && !settled && handled.current === id) handled.current = null;
      controller.abort(new AppError("reader/superseded", "Reader panel intent retired"));
    };
  }, [bookId, channel, id, targetBook, panel, report, store]);
}

/** Native controls and external actors use the same bound presentation adapter. */
export function useReaderPanels(bookId: string, visible: boolean, exclusive: boolean) {
  const sizes = useAtomValue(readerPanelSizesAtom);
  const raw = useSyncExternalStore(readerPanelLayoutStore.subscribe, readerPanelLayoutStore.getSnapshot);
  const layout = useMemo(() => getReaderPanelLayout(bookId, raw), [bookId, raw]);
  const [transient, setTransient] = useState({ bookId, annotations: false, appearance: false });
  const [token, setToken] = useState(0);
  const [chatFocusRequestId, setChatFocusRequestId] = useState(0);
  const { toast } = useToast();
  const binding = useRef<ReturnType<typeof readerPanels.bind> | null>(null);
  const boundBook = useRef<string | null>(null);
  const committed = useRef<ReaderPanelsView | null>(null);
  const environment = useRef({ exclusive });
  const selected = { toc: layout.tocOpen, chat: layout.notesOpen,
    annotations: visible && transient.bookId === bookId && transient.annotations,
    appearance: visible && transient.bookId === bookId && transient.appearance };
  useLayoutEffect(() => {
    environment.current = { exclusive };
    const view: ReaderPanelsView = { controlsVisible: visible, sizes, layout: exclusive ? "exclusive" : "docked", panels: {
      toc: { open: selected.toc, visible: visible && selected.toc },
      chat: { open: selected.chat, visible: visible && selected.chat },
      annotations: { open: selected.annotations, visible: selected.annotations },
      appearance: { open: selected.appearance, visible: selected.appearance },
    } };
    committed.current = view;
    if (boundBook.current === bookId) binding.current?.publish(view, token);
  });
  useEffect(() => { if (!visible) setTransient({ bookId, annotations: false, appearance: false }); }, [visible, bookId]);
  useEffect(() => {
    let sessionId: string | null = null;
    const stop = readingRuntime.observe(state => {
      const id = state.status === "ready" && state.bookId === bookId ? state.sessionId : null;
      if (id === sessionId) return;
      sessionId = id;
      binding.current?.dispose(); binding.current = null; boundBook.current = null;
      if (!id || !committed.current) return;
      boundBook.current = bookId;
      binding.current = readerPanels.bind(id, bookId, {
        applyWidth: updateReaderPanelWidth,
        apply: async (panel, open, signal) => {
          signal.throwIfAborted();
          if (panel === "toc" || panel === "chat") {
            const key = panel === "toc" ? "tocOpen" : "notesOpen";
            await updateReaderPanelLayout(bookId, previous => ({ ...previous, [key]: open,
              ...(open && environment.current.exclusive ? { [key === "tocOpen" ? "notesOpen" : "tocOpen"]: false } : {}),
            }), signal);
          } else setTransient(previous => signal.aborted ? previous : ({
            ...(previous.bookId === bookId ? previous : { bookId, annotations: false, appearance: false }), [panel]: open,
          }));
          signal.throwIfAborted();
          if (panel === "chat" && open) setChatFocusRequestId(value => signal.aborted ? value : value + 1);
        },
        requestCommit: setToken,
      }, committed.current);
    });
    return () => { stop(); binding.current?.dispose(); binding.current = null; boundBook.current = null; };
  }, [bookId]);
  const report = useCallback((error: unknown) => {
      if (errorCode(error) === "reader/superseded") return; // A newer user intent or retired reader owns the surface.
      log.warn("Reader panel change failed", error);
      // Native KV failures already have one global localized write-failure toast.
      if (!(error instanceof IpcError && error.command === "set_kv")) toast({ variant: "destructive", description: describeError(error).body });
  }, [toast]);
  const setPanel = useCallback((panel: ReaderPanel, open: boolean) => {
    const snapshot = readerPanels.snapshot();
    void readerPanels.setPanel(panel, open, undefined, { bookId, sessionId: snapshot?.sessionId }).catch(report);
  }, [bookId, report]);
  const panelIntent = useAtomValue(readerPanelIntentAtom);
  const askAiRequest = useAtomValue(askAiRequestAtom);
  // One consumer owns both revealing chrome and opening the target. A second
  // reveal in useReaderSession would supersede this service's pending command.
  usePanelIntent(bookId, "panel", panelIntent, report);
  usePanelIntent(bookId, "ask", askAiRequest ? { id: askAiRequest.id, bookId: askAiRequest.bookId, panel: "chat" } : null, report);
  return { ...selected, chatFocusRequestId, setPanel };
}
