import type { AgentTool } from "@earendil-works/pi-agent-core";
import { normalizeChangesQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import { arr, int, obj, oneOf, opt, str } from "@earendil-works/pi-schema";

export function buildChangeTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const port = deps.changes?.(scope);
  if (!port) return [];
  const query = obj({
    areas: arr(oneOf(["library", "reading", "annotations", "conversations", "memory", "settings"]), {
      minItems: 1,
      maxItems: 6,
    }),
    bookId: opt(str({ minLength: 1, maxLength: 512 })),
    settingsPaths: opt(arr(str({ minLength: 1, maxLength: 512 }), { minItems: 1, maxItems: 32 })),
  });
  const accepted = (raw: unknown) => normalizeChangesQuery(raw);
  return [
    {
      name: "open_change_cursor",
      label: "Start tracking changes",
      description:
        "Open a persistent change cursor BEFORE reading a baseline with domain query tools. Select areas and optional bookId; book conversations must specify their own bookId. Settings require exact readable catalog settingsPaths, including credentialConfigured presence metadata. Returns a cursor owned by this conversation scope, with no content or event history.",
      parameters: obj({ query }),
      execute: async (_id, raw, signal) =>
        textResult(await port.open(accepted((raw as { query: unknown }).query), signal)),
    },
    {
      name: "read_changes",
      label: "Read changes since cursor",
      description:
        "Continue using the same query and cursor. Notices are conservative reload hints, not actual values, raw events, or exact edit counts; query affected domains again. Empty pages with hasMore still need continuation. Use the returned cursor after processing the page. Expired cursors require opening a new cursor then reloading a baseline. Settings hints invalidate requested authorized paths sharing their storage namespace.",
      parameters: obj({
        query,
        cursor: str({ pattern: "^[a-f0-9]{48}$" }),
        limit: opt(int({ minimum: 1, maximum: 100 })),
      }),
      execute: async (_id, raw, signal) => {
        const input = raw as { query: unknown; cursor: string; limit?: number };
        return textResult(await port.read(accepted(input.query), input.cursor, input.limit, signal));
      },
    },
  ];
}
