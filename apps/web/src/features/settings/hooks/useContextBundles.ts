import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@read-aware/ui";
import type { ContextBundleHistoryPage, ContextBundleKind, ContextBundleSelector } from "@read-aware/core";
import { useTranslation } from "../../../i18n";
import { describeError } from "../../../i18n/describe-error";
import { createLogger } from "../../../platform/logger";
import { isMobileOS, isTauri } from "../../../platform/environment";
import { userDomain } from "../../../domain";
import { listLibraryBooks } from "../../library/lib/library-db";
import { createResourceOwner } from "../../../services/resources";
import type { ResourceOwner } from "../../../services/resource-owner";
import { contextBundleScopeChoices, contextBundleSelectorFor, defaultContextBundleScope, summarizeContextBundle } from "../lib/context-bundle-settings";

const log = createLogger("context-bundle-settings");
const HISTORY_LIMIT = 20;

/** The product UI acts as the user with the host's full grants through the same gate as plugins and the Agent. */
export const contextBundleSettingsHost = {
  supported: () => isTauri() && !isMobileOS(),
  books: async (): Promise<{ id: string; title: string }[]> => (await listLibraryBooks()).map(book => ({ id: book.id, title: book.title })),
  threads: (): Promise<{ id: string; title?: string }[]> => userDomain.conversations.queries.listThreads(),
  capture: (selector: ContextBundleSelector, signal: AbortSignal) => userDomain.memory.commands.context.capture(selector, signal),
  history: (query: ContextBundleSelector & { limit: number }, signal: AbortSignal) => userDomain.memory.queries.context.history(query, signal),
  export: (query: ContextBundleSelector & { version: string }, owner: ResourceOwner, signal: AbortSignal) => userDomain.memory.queries.context.export(query, owner, signal),
  createOwner: (): ResourceOwner => createResourceOwner(),
};

export type ContextBundleHistoryState =
  | { status: "unsupported" } | { status: "idle" } | { status: "loading" }
  | { status: "ready"; page: ContextBundleHistoryPage } | { status: "failed"; error: unknown };

export function useContextBundles() {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const supported = contextBundleSettingsHost.supported();
  const [recipe, setRecipeState] = useState<ContextBundleKind>("user_profile_context");
  const [scope, setScopeState] = useState("user");
  const [books, setBooks] = useState<{ id: string; title: string }[]>([]);
  const [threads, setThreads] = useState<{ id: string; title?: string }[]>([]);
  const [history, setHistory] = useState<ContextBundleHistoryState>(supported ? { status: "idle" } : { status: "unsupported" });
  const [busy, setBusy] = useState<"capture" | `save:${string}` | null>(null);
  const [revision, setRevision] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  const owner = useRef<ResourceOwner | null>(null);
  const active = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    if (supported) {
      void Promise.all([contextBundleSettingsHost.books(), contextBundleSettingsHost.threads()]).then(([bookList, threadList]) => {
        if (controller.signal.aborted) return;
        setBooks(bookList); setThreads(threadList);
      }, error => {
        if (!controller.signal.aborted) log.error("Listing context bundle scopes failed", error);
      });
    }
    return () => {
      controller.abort();
      const retired = owner.current; owner.current = null;
      if (retired) void retired.dispose().catch(error => log.warn("Context bundle resource cleanup failed", error));
    };
  }, [supported]);

  const choices = useMemo(() => contextBundleScopeChoices(recipe, books, threads), [recipe, books, threads]);
  const effectiveScope = defaultContextBundleScope(choices, scope);
  const selector = useMemo(() => contextBundleSelectorFor(recipe, effectiveScope, choices), [recipe, effectiveScope, choices]);
  const selectorKey = selector ? JSON.stringify(selector) : "";

  useEffect(() => {
    if (!supported) return;
    if (!selector) { setHistory({ status: "idle" }); return; }
    const controller = new AbortController();
    const parent = lifetime.current;
    const signal = parent ? AbortSignal.any([parent.signal, controller.signal]) : controller.signal;
    setHistory({ status: "loading" });
    void contextBundleSettingsHost.history({ ...selector, limit: HISTORY_LIMIT }, signal).then(page => {
      if (!signal.aborted) setHistory({ status: "ready", page });
    }, error => {
      if (signal.aborted) return;
      log.error("Loading context bundle history failed", error);
      setHistory({ status: "failed", error });
    });
    return () => { controller.abort(); };
    // The selector's identity is its serialized form; revision forces a reload after publication.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, selectorKey, revision]);

  const run = async (kind: "capture" | `save:${string}`, work: (signal: AbortSignal) => Promise<void>, failure: string) => {
    const parent = lifetime.current;
    if (!supported || !selector || active.current || !parent || parent.signal.aborted) return;
    active.current = true; setBusy(kind);
    try { await work(parent.signal); }
    catch (error) {
      log.error(`Context bundle ${kind.split(":")[0]} failed`, error);
      if (!parent.signal.aborted) toast({ variant: "destructive", title: t("dataSync.noticeError"), description: describeError(error, { fallback: failure }).body });
    } finally {
      active.current = false;
      if (!parent.signal.aborted) setBusy(null);
    }
  };

  const capture = () => run("capture", async signal => {
    const result = await contextBundleSettingsHost.capture(selector!, signal);
    if (signal.aborted) return;
    const summary = summarizeContextBundle(result.bundle);
    setRevision(value => value + 1);
    toast({ variant: "success", title: t("dataSync.noticeDone"), description: result.changed
      ? t("dataSync.contextBundles.captured", { version: summary.version, items: summary.items, omitted: summary.omitted })
      : t("dataSync.contextBundles.unchanged", { version: summary.version }) });
  }, t("dataSync.contextBundles.captureFailed"));

  const save = (version: string) => run(`save:${version}`, async signal => {
    const resources = owner.current ?? (owner.current = contextBundleSettingsHost.createOwner());
    const ref = await contextBundleSettingsHost.export({ ...selector!, version }, resources, signal);
    try {
      const { saved } = await resources.save(ref.id, undefined, signal);
      if (saved && !signal.aborted) toast({ variant: "success", title: t("dataSync.noticeDone"), description: t("dataSync.contextBundles.saved", { name: ref.name }) });
    } finally {
      // The sealed handle is single-use here; the saved file, if any, is already the user's copy.
      await resources.release(ref.id).catch(error => log.warn("Context bundle handle release failed", error));
    }
  }, t("dataSync.contextBundles.saveFailed"));

  return {
    supported, recipe, scope: effectiveScope, choices, selector, history, busy,
    setRecipe: (kind: ContextBundleKind) => { setRecipeState(kind); setScopeState(defaultContextBundleScope(contextBundleScopeChoices(kind, books, threads), scope)); },
    setScope: setScopeState,
    capture, save,
    retry: () => setRevision(value => value + 1),
  };
}
