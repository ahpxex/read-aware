import { AppError, normalizeWorkspaceQuery, normalizeWorkspaceTarget, type WorkspaceSnapshot } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";

/** In-memory presentation only; never evidence of native rendering. */
export function createWorkspaceFixture(): RuntimeDeps["workspace"] {
  let state: WorkspaceSnapshot = { revision: 1, surface: "shelf", collectionId: null, settings: { open: false, section: null },
    search: { open: false, query: "" }, selection: { active: false, total: 0, bookIds: [], nextCursor: null } };
  const snapshot: RuntimeDeps["workspace"]["snapshot"] = async query => {
    const accepted = normalizeWorkspaceQuery(query), copy = structuredClone(state);
    const remaining = copy.selection.bookIds.filter(id => !accepted.selectionAfter || id > accepted.selectionAfter);
    copy.selection.bookIds = remaining.slice(0, accepted.limit);
    copy.selection.nextCursor = remaining.length > accepted.limit ? copy.selection.bookIds[copy.selection.bookIds.length - 1] : null;
    return copy;
  };
  return { snapshot, navigate: async (input, revision, signal) => {
    signal?.throwIfAborted(); const target = normalizeWorkspaceTarget(input);
    if (revision !== undefined && revision !== state.revision) throw new AppError("ui/superseded", "Fixture workspace changed");
    state = { ...state, revision: state.revision + 1, settings: { open: false, section: null }, search: { ...state.search, open: false } };
    if (target.surface === "settings") state.settings = { open: true, section: target.section! };
    else if (target.surface === "search") state.search = { open: true, query: target.query! };
    else {
      state.surface = target.surface;
      if (target.surface === "shelf") {
        state.collectionId = target.collectionId ?? null;
        const ids = target.selection?.bookIds.slice().sort() ?? [];
        state.selection = { active: target.selection?.active ?? false, bookIds: ids, total: ids.length, nextCursor: null };
      }
    }
    return { status: "completed", snapshot: await snapshot() };
  } };
}
