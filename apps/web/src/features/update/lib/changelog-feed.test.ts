import { describe, expect, test } from "bun:test";
import {
  pickChangelogEntry,
  siteLocaleKey,
  type WhatsNewEntry,
} from "./changelog-feed";

const REGISTRY = [
  {
    version: "0.4.2",
    codename: "El Alto",
    date: "2026-08-12",
    text: {
      en: {
        summary: "A patch that opens the front door.",
        groups: [
          {
            kind: "new",
            items: [
              { title: "Open with ReadAware", body: "Double-clicking lands in the reader." },
              { body: "Drag book files anywhere onto the window." },
            ],
          },
          { kind: "fixed", items: [{ body: "A fix." }] },
        ],
      },
      zh: {
        summary: "一个打开前门的小更新。",
        groups: [{ kind: "new", items: [{ title: "用 ReadAware 打开", body: "双击直接进入阅读器。" }] }],
      },
    },
  },
  {
    version: "0.4.1",
    date: "2026-08-11",
    text: {
      en: { summary: "A patch for the statistics page.", groups: [] },
    },
  },
];

describe("siteLocaleKey", () => {
  test("maps the app's zh families onto the site's keys", () => {
    expect(siteLocaleKey("zh-Hans")).toBe("zh");
    expect(siteLocaleKey("zh-Hant")).toBe("zh-hant");
  });

  test("everything else maps identity", () => {
    expect(siteLocaleKey("en")).toBe("en");
    expect(siteLocaleKey("ja")).toBe("ja");
  });
});

describe("pickChangelogEntry", () => {
  test("picks the exact version in the requested locale", () => {
    const entry = pickChangelogEntry(REGISTRY, "0.4.2", "zh-Hans");
    expect(entry?.text.summary).toBe("一个打开前门的小更新。");
    expect(entry?.codename).toBe("El Alto");
    expect(entry?.date).toBe("2026-08-12");
  });

  test("falls back to English when the locale is missing", () => {
    const entry = pickChangelogEntry(REGISTRY, "0.4.2", "ja");
    expect(entry?.text.summary).toBe("A patch that opens the front door.");
  });

  test("a version the site has not curated resolves to null (pre-releases)", () => {
    expect(pickChangelogEntry(REGISTRY, "0.5.0-4", "en")).toBeNull();
  });

  test("codename is null when the entry carries none", () => {
    const entry = pickChangelogEntry(REGISTRY, "0.4.1", "en");
    expect(entry?.codename).toBeNull();
  });

  test("malformed registries and entries degrade to null, never throw", () => {
    expect(pickChangelogEntry(null, "0.4.2", "en")).toBeNull();
    expect(pickChangelogEntry("nope", "0.4.2", "en")).toBeNull();
    expect(
      pickChangelogEntry([{ version: "0.4.2", text: { en: { summary: 3 } } }], "0.4.2", "en"),
    ).toBeNull();
    // A malformed group invalidates only that locale's text — the entry
    // itself is skipped rather than half-rendered.
    expect(
      pickChangelogEntry(
        [
          {
            version: "0.4.2",
            date: "2026-08-12",
            text: { en: { summary: "ok", groups: [{ kind: "bogus", items: [] }] } },
          },
        ],
        "0.4.2",
        "en",
      ),
    ).toBeNull();
  });

  test("parses optional titles and drops nothing else", () => {
    const entry: WhatsNewEntry | null = pickChangelogEntry(REGISTRY, "0.4.2", "en");
    const news = entry?.text.groups.find((g) => g.kind === "new");
    expect(news?.items[0].title).toBe("Open with ReadAware");
    expect(news?.items[1].title).toBeUndefined();
  });
});
