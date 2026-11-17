import { expect, test } from "bun:test";
import { availableLocales, LOCALES, LOCALE_LANG } from "../src/lib/i18n";
import { DOWNLOADS } from "../src/lib/releases";
import { TOPIC_PAGES } from "../src/lib/topic-pages";
import { validateManifest } from "../scripts/search-manifest.ts";

const dist = new URL("../dist/", import.meta.url);
const manifest = validateManifest(await Bun.file(new URL("search-manifest.json", dist)).json());
const urls = new Set(manifest.pages.map((page) => page.url));

function parseJsonLdBlocks(html: string): Record<string, any>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) =>
    JSON.parse(match[1]!),
  );
}

test("every public page has a unique title, description, canonical and resolvable language alternates", async () => {
  const titles = new Set<string>();
  expect(urls.size).toBe(117);
  for (const url of urls) {
    const path = new URL(url).pathname;
    const html = await Bun.file(new URL(`${path.slice(1)}index.html`, dist)).text();
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
    const fullTitle = title.join("");
    expect(fullTitle, url).not.toBe("");
    expect(fullTitle.length, url).toBeGreaterThanOrEqual(18);
    expect(fullTitle.length, url).toBeLessThanOrEqual(70);
    expect(titles.has(fullTitle), `${url}: duplicate title "${fullTitle}"`).toBe(false);
    titles.add(fullTitle);
    expect(descriptions, url).toHaveLength(1);
    expect(descriptions[0]!.length, url).toBeGreaterThanOrEqual(35);
    expect(descriptions[0]!.length, url).toBeLessThanOrEqual(190);
    expect(canonical, url).toEqual([url]);
    expect(h1, url).toBe(1);
    const schemas = parseJsonLdBlocks(html);
    if (path === "/") {
      expect(schemas.map((s) => s["@type"])).toContain("WebSite");
    }
    if (/^\/(?:(zh-hant|zh|ja|fr|de|ru|es)\/)?(?:docs|blog)(?:\/|$)/.test(path)) {
      expect(
        schemas.map((s) => s["@type"]),
        `${url}: BreadcrumbList`,
      ).toContain("BreadcrumbList");
    }
    const blogPosting = schemas.find((s) => s["@type"] === "BlogPosting");
    if (blogPosting) {
      expect(blogPosting.headline, url).not.toContain("— ReadAware");
    }
    const locales = availableLocales(path);
    if (locales.length) {
      expect(alternates.map((a) => a.lang).sort(), url).toEqual(
        [...locales.map((l) => LOCALE_LANG[l]), "x-default"].sort(),
      );
    }
    for (const alternate of alternates) expect(urls.has(alternate.url), `${url}: ${alternate.url}`).toBe(true);
  }
});

test("Chinese platform pages have localized navigation, direct assets, FAQs, SoftwareApplication schema and actual images", async () => {
  for (const platform of ["android", "windows"]) {
    const html = await Bun.file(new URL(`zh/epub-reader-for-${platform}/index.html`, dist)).text();
    const primary: string[] = [],
      images: string[] = [],
      faqText: string[] = [];
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
      .transform(new Response(html))
      .text();
    const download = DOWNLOADS.find((p) => p.id === platform)?.primary;
    if (!download) throw new Error(`No primary ${platform} download`);
    expect(primary[0]).toBe(download.url);
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain('href="/zh/pricing/"');
    const schemas = parseJsonLdBlocks(html);
    const faq = schemas.find((s) => s["@type"] === "FAQPage");
    expect(faq).toBeDefined();
    for (const question of faq!.mainEntity) {
      expect(faqText.join("")).toContain(question.name);
      expect(faqText.join("")).toContain(question.acceptedAnswer.text);
    }
    const appSchema = schemas.find((s) => s["@type"] === "SoftwareApplication");
    expect(appSchema).toBeDefined();
    expect(appSchema!.downloadUrl).toBe(download.url);
    expect(appSchema!.operatingSystem.toLowerCase()).toBe(platform);
    for (const src of images)
      expect(await Bun.file(new URL(new URL(src, "https://readaware.app").pathname.slice(1), dist)).exists()).toBe(
        true,
      );
  }
});

test("llms.txt stays synchronized with published blog posts and topic entry pages", async () => {
  const llms = await Bun.file(new URL("llms.txt", dist)).text();
  const enSite = await Bun.file(new URL("../src/i18n/resources/en.site.json", import.meta.url)).json();
  for (const slug of Object.keys(enSite.blog.posts)) {
    expect(llms).toContain(`https://readaware.app/blog/${slug}/`);
  }
  for (const topic of TOPIC_PAGES) {
    expect(llms).toContain(`https://readaware.app${topic.path}/`);
  }
});

test("all locale privacy and pricing copy acknowledge measurement, AI processing and free sync", async () => {
  for (const locale of LOCALES) {
    const site = await Bun.file(new URL(`../src/i18n/resources/${locale}.site.json`, import.meta.url)).json();
    const docs = await Bun.file(new URL(`../src/i18n/resources/${locale}.docs.json`, import.meta.url)).json();
    expect(site.home.heroTitle).toBe("ReadAware");
    expect(site.home.download.signingNote).toContain("SmartScreen");
    expect(site.pricing.lead).toContain("50");
    for (const term of ["Cloudflare Workers", "Analytics Engine", "Do Not Track", "Global Privacy Control", "TLS"])
      expect(docs.pages.privacy.body).toContain(term);
    expect(docs.pages.privacy.body).not.toContain("Cloudflare Pages");
    expect(availableLocales(locale === "en" ? "/privacy/" : `/${locale}/privacy/`)).toEqual(LOCALES);
  }
  const login = await Bun.file(new URL("sync/login/index.html", dist)).text();
  expect(login).not.toContain("cloudflareinsights");
  expect(login).not.toContain("site-analytics");
});

test("internal anchors use the served trailing-slash form so no link goes through the 308", async () => {
  let checked = 0;
  for (const url of urls) {
    const path = new URL(url).pathname;
    const html = await Bun.file(new URL(`${path.slice(1)}index.html`, dist)).text();
    const hrefs: string[] = [];
    await new HTMLRewriter()
      .on('body a[href^="/"]', {
        element(el) {
          hrefs.push(el.getAttribute("href")!);
        },
      })
      .transform(new Response(html))
      .text();
    expect(hrefs.length, `${url}: prerendered body has internal links`).toBeGreaterThan(0);
    for (const href of hrefs) {
      const target = new URL(href, url).pathname;
      expect(target.endsWith("/") || /\.[a-z0-9]+$/i.test(target), `${url} links to ${href}`).toBe(true);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(1000);
});
