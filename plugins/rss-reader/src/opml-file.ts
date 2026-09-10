import type { PluginContext } from "@read-aware/plugin-types";
import { MAX_OPML_BYTES } from "./opml";

/** A chosen file is only staged into the form; selection does not subscribe. */
export async function pickOpmlText(ctx: PluginContext): Promise<string | null> {
  const picked = await ctx.services.resources.pick({ multiple: false, extensions: ["opml", "xml"] });
  try {
    if (picked.cancelled) return null;
    if (picked.resources.length !== 1) throw Object.assign(new Error("Expected one OPML file"), { code: "plugin/invalid-input" });
    const resource = picked.resources[0]!;
    if (resource.size > MAX_OPML_BYTES) throw Object.assign(new Error("OPML exceeds 1 MiB"), { code: "plugin/payload-too-large" });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let offset = 0, text = "";
    for (;;) {
      const chunk = await ctx.services.resources.read(resource.id, offset, Math.min(64 * 1024, MAX_OPML_BYTES - offset + 1));
      if (chunk.nextOffset !== offset + chunk.data.byteLength || !chunk.eof && chunk.nextOffset <= offset) {
        throw Object.assign(new Error("Invalid OPML resource chunk"), { code: "plugin/invalid-input" });
      }
      offset = chunk.nextOffset;
      if (offset > MAX_OPML_BYTES) throw Object.assign(new Error("OPML exceeds 1 MiB"), { code: "plugin/payload-too-large" });
      try { text += decoder.decode(chunk.data, { stream: !chunk.eof }); }
      catch { throw Object.assign(new Error("OPML must be UTF-8"), { code: "plugin/invalid-input" }); }
      if (chunk.eof) return text;
    }
  } finally {
    for (const resource of picked.resources) {
      try { await ctx.services.resources.release(resource.id); }
      catch (error) { console.warn("RSS OPML resource release failed", error); }
    }
  }
}
