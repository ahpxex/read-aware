// src/index.ts
var themeRef = "plugin:image-background:picture";
var palette = {
  bg: "#f5f1e8",
  text: "#292524",
  selection: "rgba(168,162,158,0.34)",
  rule: "rgba(41,37,36,0.16)",
  faint: "rgba(41,37,36,0.05)",
  muted: "rgba(41,37,36,0.55)"
};
function backgroundTheme(value) {
  return {
    id: "picture",
    name: "图片背景",
    polarity: "light",
    reader: { palette },
    readerBackground: { assetKey: value.key, assetRevision: value.revision, opacity: value.opacity, dim: value.dim }
  };
}
var plugin = {
  async activate(ctx) {
    const themes = ctx.contributions.themes;
    if (!themes)
      throw new Error("Reader image themes are unavailable");
    const collection = ctx.services.storage.collection("background");
    let saved = (await collection.get("current"))?.data ?? null;
    let registration;
    if (saved)
      registration = await themes.register(backgroundTheme(saved));
    let busy = false;
    const exclusive = async (run) => {
      if (busy)
        throw new Error("A background update is already in progress");
      busy = true;
      try {
        return await run();
      } finally {
        busy = false;
      }
    };
    const zh = ctx.locale.startsWith("zh");
    const text = (cn, en) => zh ? cn : en;
    const selectTheme = async (bookId) => {
      await ctx.domains.settings.commands.update([
        { path: "reading.theme", value: themeRef, target: { kind: "global" } },
        ...bookId ? [{ path: "reading.theme", value: themeRef, target: { kind: "book", bookId } }] : []
      ]);
    };
    const store = async (next, bookId) => {
      const previous = saved;
      const nextRegistration = await themes.register(backgroundTheme(next));
      try {
        await collection.put("current", next);
        await selectTheme(bookId);
      } catch (error) {
        nextRegistration.dispose();
        if (previous) {
          const superseded = registration;
          registration = await themes.register(backgroundTheme(previous));
          superseded?.dispose();
          await collection.put("current", previous);
        } else {
          await collection.delete("current");
        }
        throw error;
      }
      registration?.dispose();
      registration = nextRegistration;
      saved = next;
    };
    const removeAsset = async (value) => {
      try {
        await ctx.services.resources.assets.delete(value.key, value.revision);
      } catch {
        await ctx.services.logging.write({ level: "warn", event: "background.asset-cleanup-failed" });
      }
    };
    const view = (bookId) => ({
      kind: "detail",
      title: text("图片背景", "Image background"),
      content: [
        {
          kind: "text",
          text: saved ? `${saved.name}
${text("图片不透明度", "Image opacity")} ${Math.round(saved.opacity * 100)}% · ${text("暗度", "Dimming")} ${Math.round(saved.dim * 100)}%` : text("选择一张图片作为阅读页背景。图片保存在本机。", "Choose a reading background image. Images stay on this device.")
        }
      ],
      actions: [
        {
          id: "choose",
          label: text(saved ? "更换图片" : "选择图片", saved ? "Replace image" : "Choose image"),
          icon: "image",
          priority: "primary",
          run: () => exclusive(async () => {
            const picked = await ctx.services.resources.pick({
              extensions: ["png", "jpg", "jpeg", "webp"],
              multiple: false
            });
            const resource = picked.resources[0];
            if (!resource)
              return;
            let next;
            try {
              const receipt = await ctx.services.resources.assets.store(resource.id, {
                key: `picture-${crypto.randomUUID()}`,
                expectedRevision: null,
                name: resource.name
              });
              next = {
                key: receipt.asset.key,
                revision: receipt.asset.revision,
                name: receipt.asset.name,
                opacity: saved?.opacity ?? 0.25,
                dim: saved?.dim ?? 0
              };
              const previous = saved;
              await store(next, bookId);
              if (previous)
                await removeAsset(previous);
              return {
                view: view(bookId),
                navigation: "replace",
                toast: text("已应用图片背景", "Background applied")
              };
            } catch (error) {
              if (next && saved?.key !== next.key)
                await removeAsset(next);
              throw error;
            } finally {
              await ctx.services.resources.release(resource.id);
            }
          })
        },
        ...saved ? [
          {
            id: "adjust",
            label: text("调整效果", "Adjust appearance"),
            icon: "sliders-horizontal",
            run: () => ({
              view: {
                kind: "form",
                title: text("图片背景", "Image background"),
                submitLabel: text("应用", "Apply"),
                fields: [
                  {
                    id: "opacity",
                    kind: "number",
                    label: text("图片不透明度（%）", "Image opacity (%)"),
                    value: saved.opacity * 100,
                    min: 0,
                    max: 100,
                    step: 5,
                    helperText: text("0 为隐藏图片，100 为完全显示。", "0 hides the image; 100 shows it fully.")
                  },
                  {
                    id: "dim",
                    kind: "number",
                    label: text("暗度（%）", "Dimming (%)"),
                    value: saved.dim * 100,
                    min: 0,
                    max: 100,
                    step: 5
                  }
                ],
                onSubmit: (values) => exclusive(async () => {
                  const opacity = Number(values.opacity), dim = Number(values.dim);
                  if (![opacity, dim].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) {
                    return {
                      fieldErrors: { opacity: text("请输入 0–100 的数值", "Enter a value from 0 to 100") }
                    };
                  }
                  if (!saved)
                    return { view: view(bookId), navigation: "reset" };
                  await store({ ...saved, opacity: opacity / 100, dim: dim / 100 }, bookId);
                  return { view: view(bookId), navigation: "reset", toast: text("已应用", "Applied") };
                })
              }
            })
          },
          {
            id: "apply",
            label: text("应用背景", "Apply background"),
            run: () => exclusive(async () => {
              await selectTheme(bookId);
              return { toast: text("已应用图片背景", "Background applied") };
            })
          },
          {
            id: "remove",
            label: text("移除图片", "Remove image"),
            run: () => exclusive(async () => {
              const previous = saved;
              await collection.delete("current");
              registration?.dispose();
              registration = undefined;
              saved = null;
              if (previous)
                await removeAsset(previous);
              return {
                view: view(bookId),
                navigation: "replace",
                toast: text("已移除图片背景", "Background removed")
              };
            })
          }
        ] : []
      ]
    });
    ctx.contributions.commands.register({
      id: "open",
      title: text("图片背景", "Image background"),
      icon: "image",
      run: () => ({ view: view() })
    });
    ctx.contributions.headerActions.register({
      id: "open",
      title: text("图片背景", "Image background"),
      icon: "image",
      surface: "reader",
      view: ({ book }) => view(book?.id)
    });
  }
};
var src_default = plugin;
export {
  backgroundTheme,
  src_default as default
};
