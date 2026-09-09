import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import type { LibraryBook } from "../features/library/lib/library-types";
import { workspace, type WorkspaceView } from "../services/workspace";
import { applyWorkspaceTarget, validateWorkspaceTarget } from "../services/workspace-adapter";
import { activeCollectionAtom, activeSettingsSectionAtom, activeTopNavAtom, commandQueryAtom, commandSearchOpenAtom, settingsOpenAtom, shelfSelectionAtom } from "../state/ui";

export function useWorkspaceShell(reading: boolean, books: LibraryBook[], collections: { id: string }[], ready: boolean): number {
  const store = useStore();
  const surface = useAtomValue(activeTopNavAtom), collectionId = useAtomValue(activeCollectionAtom);
  const selection = useAtomValue(shelfSelectionAtom), settingsOpen = useAtomValue(settingsOpenAtom);
  const section = useAtomValue(activeSettingsSectionAtom), searchOpen = useAtomValue(commandSearchOpenAtom), query = useAtomValue(commandQueryAtom);
  const [token, setToken] = useState(0);
  const binding = useRef<ReturnType<typeof workspace.bind> | null>(null);
  const view: WorkspaceView = { surface: reading ? "reader" : surface.startsWith("plugin:") ? "plugin" : surface as "shelf" | "agent" | "stats",
    collectionId, settings: { open: settingsOpen, section: settingsOpen ? section : null }, search: { open: searchOpen, query },
    selection: { active: selection.active, bookIds: selection.ids } };
  const committed = useRef(view);
  useLayoutEffect(() => { committed.current = view; binding.current?.publish(view, token); });
  useEffect(() => {
    const owner = workspace.bind({ prepare: (target, signal) => validateWorkspaceTarget(store, target, signal),
      apply: (target, signal, allowClose) => applyWorkspaceTarget(store, target, signal, allowClose), requestCommit: setToken }, committed.current);
    binding.current = owner;
    return () => { owner.dispose(); if (binding.current === owner) binding.current = null; };
  }, [store]);
  // Reconcile all sources, including sync/deletion while the shelf is hidden.
  useEffect(() => {
    if (!ready) return;
    const current = store.get(activeCollectionAtom);
    const collection = current && collections.some(c => c.id === current) ? current : null;
    if (collection !== current) store.set(activeCollectionAtom, collection);
    const visible = new Set(books.filter(book => (book.collectionId ?? null) === collection).map(book => book.id));
    const old = store.get(shelfSelectionAtom);
    const ids = old.ids.filter(id => visible.has(id));
    const active = old.active && books.length > 0;
    if (ids.length !== old.ids.length || active !== old.active) store.set(shelfSelectionAtom, { active, ids });
  }, [books, collections, collectionId, ready, store]);
  return token;
}
