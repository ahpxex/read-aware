import type {
  PluginDisposable,
  PluginModule,
  PluginReaderThemeBase,
  PluginRuntimeTheme,
  PluginText,
  PluginView,
} from "@read-aware/plugin-types";

type ImageAsset = { key: string; revision: string; name: string };
export type Background = {
  id: string;
  name: string;
  base: PluginReaderThemeBase;
  image: ImageAsset;
  opacity: number;
  dim: number;
};
type Saved = { version: 2; themes: Background[] };
type Legacy = ImageAsset & { opacity: number; dim: number };
const maxThemes = 12;

export function backgroundTheme(value: Background): PluginRuntimeTheme {
  return {
    id: value.id,
    name: value.name,
    polarity: value.base.polarity,
    reader: value.base.reader,
    readerBackground: {
      assetKey: value.image.key,
      assetRevision: value.image.revision,
      opacity: value.opacity,
      dim: value.dim,
    },
  };
}

const plugin: PluginModule = {
  async activate(ctx) {
    const themes = ctx.contributions.themes;
    const settingsPage = ctx.contributions.settingsPage;
    if (!themes || !settingsPage) throw new Error("Image background settings are unavailable");
    const zh = ctx.locale.startsWith("zh");
    const text = (cn: string, en: string) => (zh ? cn : en);
    const label = (value: PluginText) =>
      typeof value === "string"
        ? value
        : (value.translations?.[ctx.locale] ?? (zh ? value.translations?.["zh-Hans"] : undefined) ?? value.default);
    const collection = ctx.services.storage.collection("background");
    const stored = (await collection.get<Saved | Legacy>("current"))?.data;
    // Read the old single-picture record without writing during activation.
    // Keep its id so an existing Reading selection continues to resolve.
    let saved: Background[] = [];
    if (stored && "themes" in stored) saved = stored.themes;
    else if (stored) {
      const base = (await themes.readerBases()).find((entry) => entry.ref === "warm")!;
      saved = [
        {
          id: "picture",
          name: text("图片背景", "Image Background"),
          base,
          image: { key: stored.key, revision: stored.revision, name: stored.name },
          opacity: stored.opacity,
          dim: stored.dim,
        },
      ];
    }
    const registrations = new Map<string, PluginDisposable>();
    for (const value of saved) registrations.set(value.id, await themes.register(backgroundTheme(value)));
    let busy = false;
    const exclusive = async <T>(run: () => Promise<T>): Promise<T> => {
      if (busy) throw new Error("A theme update is already in progress");
      busy = true;
      try {
        return await run();
      } finally {
        busy = false;
      }
    };
    const assertCurrent = (previous?: Background) => {
      if (previous && saved.find((entry) => entry.id === previous.id) !== previous)
        throw new Error("This theme changed; reopen it before editing");
    };
    const persist = (values: Background[]) => collection.put("current", { version: 2, themes: values } satisfies Saved);
    const store = async (next: Background, previous?: Background) => {
      assertCurrent(previous);
      if (!previous && saved.length >= maxThemes) throw new Error("The theme limit has been reached");
      const values = previous ? saved.map((entry) => (entry.id === previous.id ? next : entry)) : [...saved, next];
      const nextRegistration = await themes.register(backgroundTheme(next));
      try {
        await persist(values);
      } catch (error) {
        try {
          if (previous) {
            const restored = await themes.register(backgroundTheme(previous));
            registrations.get(previous.id)?.dispose();
            registrations.set(previous.id, restored);
          }
        } finally {
          nextRegistration.dispose();
        }
        throw error;
      }
      registrations.get(next.id)?.dispose();
      registrations.set(next.id, nextRegistration);
      saved = values;
    };
    const removeAsset = async (image: ImageAsset) => {
      try {
        await ctx.services.resources.assets.delete(image.key, image.revision);
      } catch {
        // The saved theme change succeeded; report cleanup separately.
        await ctx.services.logging.write({ level: "warn", event: "background.asset-cleanup-failed" });
      }
    };
    const saveWithImage = async (draft: Omit<Background, "image">, previous?: Background) => {
      assertCurrent(previous);
      const picked = await ctx.services.resources.pick({ extensions: ["png", "jpg", "jpeg", "webp"], multiple: false });
      const resource = picked.resources[0];
      if (!resource) return;
      let image: ImageAsset | undefined;
      try {
        const receipt = await ctx.services.resources.assets.store(resource.id, {
          key: `picture-${crypto.randomUUID()}`,
          expectedRevision: null,
          name: resource.name,
        });
        image = { key: receipt.asset.key, revision: receipt.asset.revision, name: receipt.asset.name };
        await store({ ...draft, image }, previous);
        if (previous) await removeAsset(previous.image);
        return {
          view: list(),
          navigation: "reset" as const,
          toast: text("已保存，可在阅读设置中选择此主题", "Saved. Select this theme in Reading settings."),
        };
      } catch (error) {
        if (image && !saved.some((entry) => entry.image.key === image!.key)) await removeAsset(image);
        throw error;
      } finally {
        await ctx.services.resources.release(resource.id);
      }
    };
    const edit = async (previous?: Background): Promise<PluginView> => {
      const bases = await themes.readerBases();
      // A saved snapshot remains editable even if its source plugin is disabled.
      if (previous && !bases.some((base) => base.ref === previous.base.ref)) bases.push(previous.base);
      return {
        kind: "form",
        title: previous ? text("编辑主题", "Edit theme") : text("新建图片主题", "New image theme"),
        submitLabel: previous ? text("保存", "Save") : text("选择图片并保存", "Choose image and save"),
        fields: [
          { id: "name", kind: "text", label: text("主题名称", "Theme name"), value: previous?.name ?? "" },
          {
            id: "base",
            kind: "select",
            label: text("基础主题", "Base theme"),
            value: previous?.base.ref ?? "warm",
            options: bases.map((base) => ({ value: base.ref, label: label(base.name) })),
            helperText: text(
              "保存基础主题的配色和排版副本，原主题之后的变化不会覆盖它。",
              "Saves a copy of the base colors and typography; later changes to the base will not overwrite it.",
            ),
          },
          {
            id: "opacity",
            kind: "number",
            label: text("图片不透明度（%）", "Image opacity (%)"),
            value: (previous?.opacity ?? 0.25) * 100,
            min: 0,
            max: 100,
            step: 5,
            helperText: text("0 为隐藏图片，100 为完全显示。", "0 hides the image; 100 shows it fully."),
          },
          {
            id: "dim",
            kind: "number",
            label: text("暗度（%）", "Dimming (%)"),
            value: (previous?.dim ?? 0) * 100,
            min: 0,
            max: 100,
            step: 5,
          },
        ],
        onSubmit: (values) =>
          exclusive(async () => {
            assertCurrent(previous);
            const name = String(values.name ?? "").trim();
            const errors: Record<string, string> = {};
            if (!name || name.length > 80)
              errors.name = text("请输入 1–80 个字符的名称", "Enter a name of 1–80 characters");
            if (
              saved.some(
                (entry) => entry.id !== previous?.id && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
              )
            )
              errors.name = text("已存在同名主题", "A theme with this name already exists");
            const base =
              previous?.base.ref === values.base ? previous.base : bases.find((entry) => entry.ref === values.base);
            if (!base) errors.base = text("请选择基础主题", "Select a base theme");
            const opacity = Number(values.opacity),
              dim = Number(values.dim);
            for (const [key, value] of Object.entries({ opacity, dim }))
              if (!Number.isFinite(value) || value < 0 || value > 100)
                errors[key] = text("请输入 0–100 的数值", "Enter a value from 0 to 100");
            if (Object.keys(errors).length) return { fieldErrors: errors };
            const draft = {
              id: previous?.id ?? `picture-${crypto.randomUUID()}`,
              name,
              base: base!,
              opacity: opacity / 100,
              dim: dim / 100,
            };
            if (!previous) return saveWithImage(draft);
            await store({ ...draft, image: previous.image }, previous);
            return { view: list(), navigation: "reset" as const, toast: text("已保存主题", "Theme saved") };
          }),
      };
    };
    const detail = (value: Background): PluginView => ({
      kind: "detail",
      title: value.name,
      content: [
        {
          kind: "text",
          text: `${text("基础主题", "Base theme")}: ${label(value.base.name)}\n${value.image.name}\n${text("图片不透明度", "Image opacity")} ${Math.round(value.opacity * 100)}% · ${text("暗度", "Dimming")} ${Math.round(value.dim * 100)}%`,
        },
      ],
      actions: [
        {
          id: "edit",
          label: text("编辑主题", "Edit theme"),
          icon: "sliders-horizontal",
          priority: "primary",
          run: async () => ({ view: await edit(value) }),
        },
        {
          id: "replace",
          label: text("更换图片", "Replace image"),
          icon: "image",
          run: () => exclusive(() => saveWithImage(value, value)),
        },
        {
          id: "remove",
          label: text("删除主题", "Delete theme"),
          run: () =>
            exclusive(async () => {
              assertCurrent(value);
              const next = saved.filter((entry) => entry.id !== value.id);
              await persist(next);
              registrations.get(value.id)?.dispose();
              registrations.delete(value.id);
              saved = next;
              await removeAsset(value.image);
              return { view: list(), navigation: "reset" as const, toast: text("已删除主题", "Theme deleted") };
            }),
        },
      ],
    });
    const list = (): PluginView => ({
      kind: "detail",
      title: text("图片背景", "Image Background"),
      content: [
        {
          kind: "text",
          text: text(
            "创建自己的图片主题，再到「阅读」设置中选择。保存不会自动切换当前主题。图片保存在本机。",
            "Create image themes, then select one in Reading settings. Saving does not switch your current theme. Images stay on this device.",
          ),
        },
        {
          kind: "list",
          items: saved.map((entry) => ({
            id: entry.id,
            title: entry.name,
            subtitle: `${label(entry.base.name)} · ${entry.image.name}`,
            icon: "image",
            onSelect: () => ({ view: detail(entry) }),
          })),
          emptyText: text("还没有图片主题", "No image themes yet"),
        },
      ],
      actions:
        saved.length < maxThemes
          ? [
              {
                id: "create",
                label: text("新建主题", "New theme"),
                icon: "plus",
                priority: "primary",
                run: async () => ({ view: await edit() }),
              },
            ]
          : [],
    });
    settingsPage.register({ view: list });
    ctx.contributions.commands.register({
      id: "open",
      title: text("图片背景", "Image Background"),
      icon: "image",
      run: () => ({ view: list() }),
    });
  },
};
export default plugin;
