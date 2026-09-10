import type { PluginContext, PluginDetailView, PluginFormView, PluginListView } from "@read-aware/plugin-types";
import { copy, settingLabel } from "./strings";

export const FONT_PATHS = ["reading.fontFamily", "appearance.contentTypography.fontFamily"] as const;
type FontPath = typeof FONT_PATHS[number];
const followPath = "appearance.contentTypography.followReader";
const target = { kind: "global" as const };

function saved(ctx: PluginContext): PluginDetailView {
  const t = copy(ctx.locale);
  return { kind: "detail", title: t.fonts, content: [{ kind: "text", text: t.fontSaved }],
    actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await fontsView(ctx), navigation: "replace" }) }] };
}

export async function fontsView(ctx: PluginContext): Promise<PluginListView> {
  const t = copy(ctx.locale), snapshot = await ctx.domains.settings.queries.snapshot({ target });
  const follow = snapshot.settings.find(s => s.path === followPath);
  return { kind: "list", title: t.fonts, items: FONT_PATHS.map(path => {
    const setting = snapshot.settings.find(s => s.path === path);
    if (!setting) throw Object.assign(Error("Font setting unavailable"), { code: "settings/options-forbidden" });
    return { id: path, title: settingLabel(ctx.locale, path), subtitle: setting.value === null ? t.appDefault : String(setting.value), icon: "text-aa",
      ...(setting.writable && (path !== FONT_PATHS[1] || follow?.writable) ? { onSelect: async () => ({ view: await fontCatalog(ctx, path) }) } : {}),
    };
  }), actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await fontsView(ctx), navigation: "replace" }) },
    ...(follow?.writable ? [{ id: "follow", label: t.follow, icon: "text-aa", run: () => ({ view: {
      kind: "form", title: t.fonts, submitLabel: t.saveFollow,
      fields: [{ id: "follow", kind: "toggle", label: t.follow, value: follow.value === true }],
      onSubmit: async values => {
        if (typeof values.follow !== "boolean") return { fieldErrors: { follow: t.invalid } };
        await ctx.domains.settings.commands.update([{ path: followPath, value: values.follow, target }]);
        return { view: saved(ctx), navigation: "replace" };
      },
    } satisfies PluginFormView }) }] : []),
  ] };
}

export async function fontCatalog(ctx: PluginContext, path: FontPath, search = "", offsets = [0], revision?: number): Promise<PluginListView> {
  const t = copy(ctx.locale);
  const page = await ctx.domains.settings.queries.options({ path, target, search, offset: offsets[offsets.length - 1], limit: 40, revision });
  const go = async (next: number[]) => ({ view: await fontCatalog(ctx, path, search, next, page.revision), navigation: "replace" as const });
  return { kind: "list", title: settingLabel(ctx.locale, path), emptyText: t.noFonts,
    items: page.options.map((option, index) => ({ id: String(page.offset + index), title: option.label, icon: "text-aa",
      onSelect: () => ({ view: { kind: "detail", title: option.label,
        content: [{ kind: "text", text: settingLabel(ctx.locale, path) }], actions: [
          { id: "apply", label: t.saveFonts, icon: "check", run: async () => {
            // Selecting an independent content font also enables that native setting.
            await ctx.domains.settings.commands.update([{ path, value: option.value, target },
              ...(path === FONT_PATHS[1] ? [{ path: followPath, value: false, target }] : [])]);
            return { view: saved(ctx), navigation: "replace" };
          } },
        ],
      } satisfies PluginDetailView }),
    })), actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await fontCatalog(ctx, path, search), navigation: "replace" }) },
      { id: "search", label: t.search, icon: "magnifying-glass", run: () => ({ view: { kind: "form", title: t.search, submitLabel: t.search,
        fields: [{ id: "query", kind: "text", label: t.query, value: search }], onSubmit: async values => {
          if (typeof values.query !== "string" || values.query.length > 120) return { fieldErrors: { query: t.invalidSearch } };
          return { view: await fontCatalog(ctx, path, values.query.trim()) };
        },
      } satisfies PluginFormView }) },
    ], pagination: { page: offsets.length,
      ...(offsets.length > 1 ? { onPrevious: () => go(offsets.slice(0, -1)) } : {}),
      ...(page.nextOffset === null ? {} : { onNext: () => go([...offsets, page.nextOffset!]) }),
    },
  };
}
