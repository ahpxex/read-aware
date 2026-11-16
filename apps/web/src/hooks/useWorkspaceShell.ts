import { actorFromEvent, mergeEventCauses } from "../platform/domain-actor";
import { readingRuntime } from "../domain/reading-runtime";
import { stampWorkspaceView } from "../services/workspace-causes";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import type { LibraryBook } from "../features/library/lib/library-types";
import { workspace, type WorkspaceView } from "../services/workspace";
import { applyWorkspaceTarget, validateWorkspaceTarget } from "../services/workspace-adapter";
import {
  workspaceSourcesAtom,
  activeCollectionAtom,
  activeSettingsSectionAtom,
  activeTopNavAtom,
  commandQueryAtom,
  commandSearchOpenAtom,
  settingsOpenAtom,
  shelfSelectionAtom,
} from "../state/ui";

export function useWorkspaceShell(
  reading: boolean,
  books: LibraryBook[],
  collections: { id: string }[],
  ready: boolean,
): number {
  const store = useStore();
  const surface = useAtomValue(activeTopNavAtom),
    collectionId = useAtomValue(activeCollectionAtom);
  const selection = useAtomValue(shelfSelectionAtom),
    settingsOpen = useAtomValue(settingsOpenAtom);
  const section = useAtomValue(activeSettingsSectionAtom),
    searchOpen = useAtomValue(commandSearchOpenAtom),
    query = useAtomValue(commandQueryAtom);
  const [token, setToken] = useState(0);
  const binding = useRef<ReturnType<typeof workspace.bind> | null>(null);
  const view: WorkspaceView = {
    surface: reading
      ? "reader"
      : surface.startsWith("plugin:")
        ? "plugin"
        : (surface as "shelf" | "agent" | "stats" | "annotations"),
    collectionId,
    settings: { open: settingsOpen, section: settingsOpen ? section : null },
    search: { open: searchOpen, query },
    selection: { active: selection.active, bookIds: selection.ids },
  };
  const sources = useAtomValue(workspaceSourcesAtom);
  const committed = useRef<WorkspaceView | undefined>(undefined);
  useLayoutEffect(() => {
    const current = stampWorkspaceView(view, committed.current, { ...sources, reader: readingRuntime.snapshot() });
    committed.current = current;
    binding.current?.publish(current, token);
  });
  useEffect(() => {
    const owner = workspace.bind(
      {
        prepare: (target, signal) => validateWorkspaceTarget(store, target, signal),
        apply: (target, signal, allowClose, source) => applyWorkspaceTarget(store, target, signal, allowClose, source),
        requestCommit: setToken,
      },
      committed.current!,
    );
    binding.current = owner;
    return () => {
      owner.dispose();
      if (binding.current === owner) binding.current = null;
    };
  }, [store]);
  const reconciled = useRef<{ books: LibraryBook[]; collection: string | null } | null>(null);
  // Reconcile all sources, including sync/deletion while the shelf is hidden.
  useEffect(() => {
    if (!ready) return;
    const current = store.get(activeCollectionAtom);
    const collection = current && collections.some((c) => c.id === current) ? current : null;
    if (collection !== current) store.set(activeCollectionAtom, collection, actorFromEvent(collections));
    const visible = new Set(books.filter((book) => (book.collectionId ?? null) === collection).map((book) => book.id));
    const old = store.get(shelfSelectionAtom);
    const ids = old.ids.filter((id) => visible.has(id));
    const active = old.active && books.length > 0;
    if (ids.length !== old.ids.length || active !== old.active) {
      const collectionSource = store.get(workspaceSourcesAtom).collection;
      const changedSources: object[] = [
        ...(!reconciled.current || reconciled.current.books !== books ? [books] : []),
        ...(collection !== current || (reconciled.current && reconciled.current.collection !== collection)
          ? [collectionSource]
          : []),
      ];
      if (!changedSources.length) changedSources.push(store.get(workspaceSourcesAtom).selection);
      store.set(shelfSelectionAtom, { active, ids }, actorFromEvent(mergeEventCauses(changedSources, {})));
    }
    reconciled.current = { books, collection };
  }, [books, collections, collectionId, ready, store]);
  return token;
}
