import type { PluginDetailView, PluginFormView, PluginListView, ReadingLocation, ReadingTarget } from "@read-aware/plugin-types";
import type { JumperContext } from "./types";
import { navigationWords } from "./navigation-strings";

type Source = Pick<ReadingLocation, "bookId" | "contentVersion">;
type Step = Parameters<JumperContext["domains"]["reading"]["commands"]["step"]>[0];
const steps: Array<{ id: Step; icon: string }> = [
  { id: "previous", icon: "arrow-left" }, { id: "next", icon: "arrow-right" },
  { id: "previous-section", icon: "skip-back" }, { id: "next-section", icon: "skip-forward" },
  { id: "previous-chapter", icon: "caret-left" }, { id: "next-chapter", icon: "caret-right" },
  { id: "start", icon: "arrow-line-left" }, { id: "end", icon: "arrow-line-right" },
];

async function navigate(ctx: JumperContext, target: ReadingTarget) {
  await ctx.domains.reading.commands.goTo(target);
  return { close: true };
}

export async function navigationView(ctx: JumperContext): Promise<PluginDetailView> {
  const t = navigationWords(ctx.locale), session = await ctx.domains.reading.queries.session();
  if (session.status !== "ready" || !session.bookId || !session.sessionId || !session.location) {
    throw Object.assign(Error("Navigation requires a ready reader"), { code: "reader/unavailable" });
  }
  const source = { bookId: session.bookId, contentVersion: session.location.contentVersion };
  const guard = { bookId: session.bookId, sessionId: session.sessionId };
  const pagination = session.pagination;
  return { kind: "detail", title: t.navigation, content: [
    ...(pagination ? [{ kind: "keyValue" as const, rows: [
      { label: t.section, value: `${pagination.section.index + 1} / ${pagination.section.count}` },
      ...(pagination.screen ? [{ label: t.screen, value: `${pagination.screen.index + 1} / ${pagination.screen.count}` }] : []),
    ] }] : []),
    { kind: "list", items: [
      { id: "sections", title: t.sections, icon: "list-bullets", onSelect: async () => ({ view: await navigationTargets(ctx, source, "sections") }) },
      { id: "pages", title: t.pages, icon: "files", onSelect: async () => ({ view: await navigationTargets(ctx, source, "pages") }) },
      ...steps.map(step => ({ id: step.id, title: t[step.id], icon: step.icon, onSelect: async () => {
        await ctx.domains.reading.commands.step(step.id, guard); return { close: true };
      } })),
    ] },
  ], actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await navigationView(ctx), navigation: "replace" }) }] };
}

export async function navigationTargets(ctx: JumperContext, source: Source, kind: "sections" | "pages", offsets = [0], label?: string): Promise<PluginListView> {
  const t = navigationWords(ctx.locale);
  const page = await ctx.domains.library.queries.books.listNavigationTargets({ ...source, kind, offset: offsets[offsets.length - 1], limit: 40,
    ...(label === undefined ? {} : { label }) });
  const go = async (next: number[]) => ({ view: await navigationTargets(ctx, source, kind, next, label), navigation: "replace" as const });
  return { kind: "list", title: kind === "sections" ? t.sections : t.pages,
    emptyText: page.status === "absent" ? t.absent : t.empty,
    items: page.items.map(item => ({ id: String(item.index), title: item.label ? `${item.label}${item.labelTruncated ? "..." : ""}` : `${kind === "sections" ? t.section : t.page} ${item.index + 1}`,
      icon: "file-text", subtitle: [item.location ? "" : t.unlocated, item.linear === false ? t.nonLinear : ""].filter(Boolean).join(" / "),
      ...(item.location ? { onSelect: () => navigate(ctx, item.location!) } : {}),
    })), actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => {
        const toc = await ctx.domains.library.queries.books.getNavigationToc(source.bookId);
        return { view: await navigationTargets(ctx, { bookId: toc.bookId, contentVersion: toc.contentVersion }, kind, [0], label), navigation: "replace" };
      } },
      ...(page.status === "available" && (kind === "pages" || page.total > 0) ? [{ id: "find", label: kind === "sections" ? t.number : t.findPage, icon: "magnifying-glass", run: () => ({ view: kind === "sections" ? {
        kind: "form", title: t.sections, submitLabel: t.jump, fields: [{ id: "number", kind: "number", label: t.number, min: 1, max: page.total, step: 1 }],
        onSubmit: async values => {
          const number = values.number;
          if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || number > page.total) return { fieldErrors: { number: t.invalidSection } };
          return navigate(ctx, { ...source, sectionIndex: number - 1 });
        },
      } satisfies PluginFormView : {
        kind: "form", title: t.findPage, submitLabel: t.jump, fields: [{ id: "label", kind: "text", label: t.page, value: label ?? "" }],
        onSubmit: async values => {
          if (typeof values.label !== "string" || !values.label.trim() || values.label.length > 300) return { fieldErrors: { label: t.invalidLabel } };
          return { view: await navigationTargets(ctx, source, "pages", [0], values.label) };
        },
      } satisfies PluginFormView }) }] : []),
    ], pagination: { page: offsets.length,
      ...(offsets.length > 1 ? { onPrevious: () => go(offsets.slice(0, -1)) } : {}),
      ...(page.nextOffset === null ? {} : { onNext: () => go([...offsets, page.nextOffset!]) }),
    },
  };
}
