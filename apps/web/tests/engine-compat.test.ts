/**
 * Semantic tests for `patchedDependencies` — dependency code the app ships to
 * iOS 16.0 WebKit, which cannot parse regex lookbehind (issue #41). Each test
 * imports the real patched module out of the installed dependency graph, so a
 * lost or reverted patch fails here.
 */
import { describe, expect, test } from "bun:test";

/** Resolve a package the way its installed consumer does. */
const through = (specifier: string, importer: string) => Bun.resolveSync(specifier, importer);
const streamdown = through("streamdown", new URL("./probe.ts", import.meta.url).pathname);

// remend dropped the lookbehind upstream in 1.4.0 (same rewrite as our former
// patch); these keep pinning the behavior the app relies on.
describe("remend (via streamdown)", () => {
  const remend = async () => (await import(through("remend", streamdown))).default as (input: string) => string;

  test("still escapes single tildes between word characters", async () => {
    const fix = await remend();
    expect(fix("a~b")).toBe("a\\~b");
    // Adjacent matches: the rewritten pattern consumes the preceding
    // character and must still find both tildes.
    expect(fix("a~b~c")).toBe("a\\~b\\~c");
    expect(fix("文字~x")).toBe("文字\\~x");
  });

  test("keeps untouched what the lookbehind version left alone", async () => {
    const fix = await remend();
    expect(fix("a~~b~~c")).toBe("a~~b~~c");
    expect(fix("~leading")).toBe("~leading");
    expect(fix("`code~x` a~b")).toBe("`code~x` a\\~b");
    expect(fix("plain text")).toBe("plain text");
  });
});

describe("mdast-util-gfm-autolink-literal (via streamdown)", () => {
  const modules = async () => {
    const gfm = through("mdast-util-gfm", streamdown);
    const { fromMarkdown } = await import(through("mdast-util-from-markdown", gfm));
    const { gfmAutolinkLiteralFromMarkdown } = await import(through("mdast-util-gfm-autolink-literal", gfm));
    const { gfmAutolinkLiteral } = await import(through("micromark-extension-gfm-autolink-literal", gfm));
    return { fromMarkdown, gfmAutolinkLiteralFromMarkdown, gfmAutolinkLiteral };
  };

  const linkUrls = async (text: string, micromark: boolean) => {
    const { fromMarkdown, gfmAutolinkLiteralFromMarkdown, gfmAutolinkLiteral } = await modules();
    const tree = fromMarkdown(text, {
      extensions: micromark ? [gfmAutolinkLiteral()] : [],
      mdastExtensions: [gfmAutolinkLiteralFromMarkdown()],
    });
    const urls: string[] = [];
    const walk = (node: {
      type: string;
      url?: string;
      children?: { type: string; url?: string; children?: never[] }[];
    }) => {
      if (node.type === "link" && node.url) urls.push(node.url);
      node.children?.forEach((child) => walk(child as never));
    };
    walk(tree as never);
    return urls;
  };

  // The transform pass is where the patched pattern runs: it scans text the
  // micromark tokenizer did not already claim as autolinks.
  test("email boundaries match the dropped lookbehind exactly", async () => {
    // A letter before the local part blocks the match start, but a retry one
    // position later can still link the tail.
    expect(await linkUrls("éa.b@x.com", false)).toEqual(["mailto:b@x.com"]);
    // CJK letter before the local part: no link.
    expect(await linkUrls("中a@b.com", false)).toEqual([]);
    // Punctuation allows the link.
    expect(await linkUrls("foo,a@b.com", false)).toEqual(["mailto:a@b.com"]);
    // A slash passes the lookbehind but not the email-specific check.
    expect(await linkUrls("x/a@b.com", false)).toEqual([]);
    // Two adjacent emails separated by punctuation both link.
    expect(await linkUrls("a@b.com;c@d.com", false)).toEqual(["mailto:a@b.com", "mailto:c@d.com"]);
    expect(await linkUrls("mail a@b.com please", false)).toEqual(["mailto:a@b.com"]);
    expect(await linkUrls("x=a@b.com", false)).toEqual(["mailto:a@b.com"]);
  });

  test("production shape with the micromark extension is unchanged", async () => {
    expect(await linkUrls("mail a@b.com please", true)).toEqual(["mailto:a@b.com"]);
    expect(await linkUrls("a@b.com;c@d.com", true)).toEqual(["mailto:a@b.com", "mailto:c@d.com"]);
    expect(await linkUrls("x/a@b.com", true)).toEqual([]);
    expect(await linkUrls("see www.example.com now", true)).toEqual(["http://www.example.com"]);
  });
});
