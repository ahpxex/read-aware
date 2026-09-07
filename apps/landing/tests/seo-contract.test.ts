import { expect, test } from "bun:test";
import {
  availableLocales,
  localeFromPathname,
  LOCALES,
  LOCALE_LANG,
} from "../src/lib/i18n";
import { DOWNLOADS } from "../src/lib/releases";
import { validateManifest } from "../scripts/search-manifest.mjs";

const dist = new URL("../dist/", import.meta.url);
const manifest = validateManifest(
  await Bun.file(new URL("search-manifest.json", dist)).json(),
);
const urls = new Set<string>(
  manifest.pages.map((page: { url: string }) => page.url),
);

test("every public page has a unique title, description, canonical and resolvable language alternates", async () => {
  const titles = new Set<string>();
  expect(urls.size).toBe(117);
  for (const url of urls) {
    const path = new URL(url).pathname;
    const html = await Bun.file(
      new URL(`${path.slice(1)}index.html`, dist),
    ).text();
    const title: string[] = [],
      descriptions: string[] = [],
      canonical: string[] = [],
      alternates: { lang: string; url: string }[] = [];
    let h1 = 0;
    await new HTMLRewriter()
      .on("head title", {
        text(t) {
          title.push(t.text);
        },
      })
      .on('head meta[name="description"]', {
        element(el) {
          descriptions.push(el.getAttribute("content") ?? "");
        },
      })
      .on('head link[rel="canonical"]', {
        element(el) {
          canonical.push(el.getAttribute("href") ?? "");
        },
      })
      .on("head link[hreflang]", {
        element(el) {
          alternates.push({
            lang: el.getAttribute("hreflang")!,
            url: el.getAttribute("href")!,
          });
        },
      })
      .on("h1", {
        element() {
          h1++;
        },
      })
      .transform(new Response(html))
      .text();
    expect(title.join(""), url).not.toBe("");
    const localizedTitle = `${localeFromPathname(path)}:${title.join("")}`;
    expect(titles.has(localizedTitle), url).toBe(false);
    titles.add(localizedTitle);
    expect(descriptions, url).toHaveLength(1);
    expect(descriptions[0]!.length, url).toBeGreaterThan(20);
    expect(canonical, url).toEqual([url]);
    expect(h1, url).toBe(1);
    const locales = availableLocales(path);
    if (locales.length) {
      expect(alternates.map((a) => a.lang).sort(), url).toEqual(
        [...locales.map((l) => LOCALE_LANG[l]), "x-default"].sort(),
      );
    }
    for (const alternate of alternates)
      expect(urls.has(alternate.url), `${url}: ${alternate.url}`).toBe(true);
  }
});

test("Chinese platform pages have localized navigation, direct assets, FAQs and actual images", async () => {
  for (const platform of ["android", "windows"]) {
    const html = await Bun.file(
      new URL(`zh/epub-reader-for-${platform}/index.html`, dist),
    ).text();
    const primary: string[] = [],
      images: string[] = [],
      faqText: string[] = [],
      schemas: string[] = [];
    await new HTMLRewriter()
      .on("article > header a", {
        element(el) {
          primary.push(el.getAttribute("href")!);
        },
      })
      .on("main img", {
        element(el) {
          images.push(el.getAttribute("src")!);
        },
      })
      .on("dt, dd", {
        text(t) {
          faqText.push(t.text);
        },
      })
      .on('script[type="application/ld+json"]', {
        text(t) {
          schemas.push(t.text);
        },
      })
      .transform(new Response(html))
      .text();
    expect(primary[0]).toBe(
      DOWNLOADS.find((p) => p.id === platform)?.primary?.url,
    );
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain('href="/zh/pricing"');
    const faq = JSON.parse(schemas.join(""));
    expect(faq["@type"]).toBe("FAQPage");
    for (const question of faq.mainEntity) {
      expect(faqText.join("")).toContain(question.name);
      expect(faqText.join("")).toContain(question.acceptedAnswer.text);
    }
    for (const src of images)
      expect(
        await Bun.file(
          new URL(
            new URL(src, "https://readaware.app").pathname.slice(1),
            dist,
          ),
        ).exists(),
      ).toBe(true);
  }
});

test("all locale privacy and pricing copy acknowledge measurement, AI processing and free sync", async () => {
  for (const locale of LOCALES) {
    const site = await Bun.file(
      new URL(`../src/i18n/resources/${locale}.site.json`, import.meta.url),
    ).json();
    const docs = await Bun.file(
      new URL(`../src/i18n/resources/${locale}.docs.json`, import.meta.url),
    ).json();
    expect(site.home.heroTitle).toBe("ReadAware");
    expect(site.home.download.signingNote).toContain("SmartScreen");
    expect(site.pricing.lead).toContain("50");
    for (const term of [
      "Cloudflare Workers",
      "Analytics Engine",
      "Do Not Track",
      "Global Privacy Control",
      "TLS",
    ])
      expect(docs.pages.privacy.body).toContain(term);
    expect(docs.pages.privacy.body).not.toContain("Cloudflare Pages");
    expect(
      availableLocales(locale === "en" ? "/privacy/" : `/${locale}/privacy/`),
    ).toEqual(LOCALES);
  }
  const login = await Bun.file(new URL("sync/login/index.html", dist)).text();
  expect(login).not.toContain("cloudflareinsights");
  expect(login).not.toContain("site-analytics");
});
