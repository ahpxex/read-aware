import type { PluginView, PluginViewPagination } from "@read-aware/plugin-types";

/** Keep the host's exact offsets, including UTF-16-safe text boundaries. */
export function contentPagination(offsets: number[], nextOffset: number | null,
  load: (offsets: number[]) => Promise<PluginView>): PluginViewPagination {
  const go = async (next: number[]) => ({ view: await load(next), navigation: "replace" as const });
  return { page: offsets.length,
    ...(offsets.length > 1 ? { onPrevious: () => go(offsets.slice(0, -1)) } : {}),
    ...(nextOffset === null ? {} : { onNext: () => go([...offsets, nextOffset]) }),
  };
}
