import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AppError, MAX_BOOK_FILE_CHECK } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import { arr, obj, opt, str } from "@earendil-works/pi-schema";

export function buildBookContentTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  return [
    {
      name: "get_book_content_state",
      label: "Check book source",
      description:
        "Read one book's source revision token, for telling whether its content changed since a reading session loaded it. For whether books can be opened (file on this device, retrievable, or gone) use check_book_files, which covers many books at once; here availability=missing only means the file is not on this device. Reads source availability and an opaque sourceRevision without parsing, downloading or invoking a content provider. A registered virtual provider is not proof its content is cached, reachable or readable; its contentVersion is null because no load occurs. Compare sourceRevision with get_reading_session.sourceRevision ONLY for the same ready book: different tokens mean a known source/provider change, equal tokens do not prove an unannounced remote change did not happen. Reading state requires its separate query; this returns no private provider keys, paths, URLs or bytes. Book threads are restricted to their own book. Use navigate_reading(reload) only on an explicit user request, since it restarts reading at the beginning.",
      parameters: obj({ bookId: opt(str({ minLength: 1, maxLength: 256 })) }),
      execute: async (_id, params, signal) => {
        signal?.throwIfAborted();
        const bookId = (params as { bookId?: string }).bookId ?? (scope.kind === "book" ? scope.bookId : "");
        if (typeof bookId !== "string" || !bookId.trim() || bookId.length > 256)
          throw new AppError("ui/invalid-target", "Book ID required");
        if (scope.kind === "book" && bookId !== scope.bookId)
          throw new AppError("memory/forbidden", "Content state belongs to another book");
        const result = await deps.library.getContentState(bookId, signal);
        signal?.throwIfAborted();
        return textResult(result);
      },
    },
    {
      name: "check_book_files",
      label: "Check book files",
      description:
        "Find out whether books can actually be opened on this device. For each book: on-device (the file is here), retrievable (not here, but sync holds a copy that opening the book downloads), unretrievable (the sync backend was asked and holds no copy: the file is gone) or unknown (nobody could be asked, so the file may still exist). Only unretrievable books are shelf entries left without a file. unknown is never proof of loss; tell the reader the reason and what would settle it, and do not start a deletion for those books in the same reply: no-sync = sync is off on this device, turning it on may bring the file back; not-connected = signed out of sync or its backend is unavailable, signing in again may; unauthenticated = the sync session was refused; unreachable = the backend did not answer, retry later; unverifiable = this backend can only answer by downloading. Omit bookIds to check every book whose file is not on this device (remaining counts the ones left for another call); in a book conversation it checks that book. Asks the sync backend once per missing file and downloads nothing.",
      parameters: obj({
        bookIds: opt(
          arr(str({ minLength: 1, maxLength: 256 }), {
            minItems: 1,
            maxItems: MAX_BOOK_FILE_CHECK,
            description: "Book ids from list_books; omit for every book whose file is not on this device",
          }),
        ),
      }),
      execute: async (_id, params, signal) => {
        signal?.throwIfAborted();
        const requested = (params as { bookIds?: string[] }).bookIds;
        if (scope.kind === "book" && requested?.some((id) => id !== scope.bookId))
          throw new AppError("memory/forbidden", "File checks in a book conversation cover that book only");
        const result = await deps.library.checkBookFiles(scope.kind === "book" ? [scope.bookId] : requested, signal);
        signal?.throwIfAborted();
        return textResult(result);
      },
    },
  ];
}
