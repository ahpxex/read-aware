import { AppError, type BookTextRange, type ReadingTextQuote } from "@read-aware/core";
import type { FoliateView } from "./foliate-engine";

/** Resolve a validated source range against its own currently rendered document. */
export function renderedBookRange(view: FoliateView, target: BookTextRange, resolveTextQuote: (doc: Document, quote: ReadingTextQuote) => Range) {
  try {
    const resolved = view.resolveCFI(target.cfi);
    const content = view.renderer?.getContents().find(content => content.index === resolved.index);
    if (!content) return null;
    const anchor = typeof resolved.anchor === "function" ? resolved.anchor(content.doc)
      : target.textQuote ? resolveTextQuote(content.doc, target.textQuote) : resolved.anchor;
    if (!anchor || typeof anchor === "number" || !("commonAncestorContainer" in anchor) || anchor.collapsed
      || anchor.startContainer.ownerDocument !== content.doc || anchor.endContainer.ownerDocument !== content.doc) {
      throw new Error("A nonempty range in the rendered document is required");
    }
    return { content, range: anchor };
  } catch (cause) { throw new AppError("reader/target-not-found", "Source range no longer resolves uniquely in the rendered document", { cause }); }
}
