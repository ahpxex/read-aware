import type { PluginAction, PluginContext, PluginDetailView, PluginView } from "@read-aware/plugin-types";
import { tr } from "./strings";
import { ensureReadingSession } from "./reader-session";

type ImageService = NonNullable<NonNullable<PluginContext["services"]["ui"]["reader"]>["image"]>;
type Snapshot = Awaited<ReturnType<ImageService["snapshot"]>>;
type Request = Parameters<NonNullable<ImageService["control"]>>[0];

export async function openImageControls(ctx: PluginContext, query: Parameters<NonNullable<ImageService["open"]>>[0]) {
  const guard = await ensureReadingSession(ctx, query.image.bookId);
  const receipt = await ctx.services.ui.reader!.image!.open!(query, guard);
  if (receipt.status !== "opened") return { toast: tr(ctx.locale, `image_${receipt.reason}`) };
  return { view: await imageControls(ctx) };
}

export async function imageControls(ctx: PluginContext): Promise<PluginDetailView & Pick<PluginView, "live">> {
  const image = ctx.services.ui.reader?.image;
  if (!image?.control) throw Object.assign(Error("Image controls unavailable"), { code: "ui/unavailable" });
  const control = image.control.bind(image);
  const render = (snapshot: Snapshot): PluginDetailView => {
    const actions: PluginAction[] = [];
    if (snapshot) {
      // A rendered action always targets the viewer the user saw, never a later replacement.
      const id = snapshot.id;
      const request = async (operation: Request) => {
        const receipt = await control(operation);
        return receipt.status === "closed" ? { close: "all" as const } : { toast: tr(ctx.locale, "imageUpdated") };
      };
      for (const [action, label, icon] of [
        ["zoom-in", "zoomIn", "plus"], ["zoom-out", "zoomOut", "magnifying-glass"],
        ["rotate", "rotateImage", "arrows-clockwise"], ["reset", "resetImage", "arrows-clockwise"],
      ] as const) actions.push({ id: action, label: tr(ctx.locale, label), icon, run: () => request({ id, action }) });
      for (const [direction, dx, dy, icon] of [
        ["panLeft", -0.15, 0, "arrow-left"], ["panRight", 0.15, 0, "arrow-right"],
        ["panUp", 0, -0.15, undefined], ["panDown", 0, 0.15, undefined],
      ] as const) actions.push({ id: direction, label: tr(ctx.locale, direction), icon,
        run: () => request({ id, action: "pan", dx, dy }) });
      actions.push(
        { id: "show-image", label: tr(ctx.locale, "showImage"), icon: "arrow-square-out", run: () => ({ close: "all" }) },
        { id: "close-image", label: tr(ctx.locale, "closeImage"), icon: "stop", run: () => request({ id, action: "close" }) },
      );
    }
    actions.push({ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise",
      run: async () => ({ view: await imageControls(ctx), navigation: "replace" }) });
    return { kind: "detail", title: tr(ctx.locale, "imageControls"),
      content: snapshot ? [{ kind: "keyValue", rows: [
        { label: tr(ctx.locale, "imageScale"), value: `${Math.round(snapshot.scale * 100)}%` },
        { label: tr(ctx.locale, "imageRotation"), value: `${snapshot.rotation}\u00b0` },
        { label: tr(ctx.locale, "imagePanX"), value: `${Math.round(snapshot.panX * 100)}%` },
        { label: tr(ctx.locale, "imagePanY"), value: `${Math.round(snapshot.panY * 100)}%` },
      ] }] : [{ kind: "text", text: tr(ctx.locale, "noOpenImage") }], actions };
  };
  return { ...render(await image.snapshot()), live: { subscribe(channel) {
    let active = true, revision = 0;
    const subscription = image.observe(async snapshot => {
      if (!active) return;
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: render(snapshot) });
    });
    return { dispose() {
      if (!active) return;
      active = false;
      subscription.dispose();
    } };
  } } };
}
