/**
 * Post-build prerendering: renders every static route with the SSR bundle
 * (dist-ssr/entry-server.js, built by `vite build --ssr`) and writes real
 * HTML into dist/, one `<path>/index.html` per route. Static hosting then
 * serves parseable HTML to crawlers and AI agents at every docs/blog URL,
 * while the browser boots the unchanged SPA on top.
 *
 * Besides lifting each route's <title>/<meta name="description"> into the
 * document head, this script owns the per-page SEO surface: canonical link,
 * hreflang alternates, Open Graph / Twitter cards, SoftwareApplication
 * JSON-LD on the homepages, and dist/sitemap.xml. Tags that the router's
 * <HeadContent /> also manages at runtime are marked `data-prerender` so
 * main.tsx can drop the static copy before hydration.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { contentHash, validateManifest } from "./search-manifest.ts";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(appDir, "dist");

const { render, staticPaths } = await import(join(appDir, "dist-ssr", "entry-server.js"));

const template = await readFile(join(distDir, "index.html"), "utf8");
const paths = staticPaths();
const pathSet = new Set(paths);

const SITE_ORIGIN = "https://readaware.app";
const SITE_NAME = "ReadAware";
const OG_IMAGE = `${SITE_ORIGIN}/og.jpg`;
const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";
const DOWNLOAD_URL = "https://github.com/ahpxex/read-aware/releases/latest";
const WINDOWS_DOWNLOAD_URL =
  "https://github.com/ahpxex/read-aware/releases/latest/download/ReadAware-windows-x64-setup.exe";
const ANDROID_DOWNLOAD_URL =
  "https://github.com/ahpxex/read-aware/releases/latest/download/ReadAware-android-arm64.apk";
const GITHUB_URL = "https://github.com/ahpxex/read-aware";
const DISCORD_URL = "https://discord.gg/whDrKXwHWU";
const LOGO_URL = `${SITE_ORIGIN}/favicon.png`;
const FEED_URL = `${SITE_ORIGIN}/feed.xml`;
const SHELF_SCREENSHOT_LIGHT = "/screenshots/shelf-light.webp?v=043";
const SHELF_SCREENSHOT_DARK = "/screenshots/shelf-dark.webp?v=043";

// Locale prefixes must mirror src/lib/i18n.ts.
const LOCALES = [
  { locale: "en", prefix: "", hreflang: "en", ogLocale: "en_US" },
  { locale: "zh", prefix: "/zh", hreflang: "zh-CN", ogLocale: "zh_CN" },
  { locale: "zh-hant", prefix: "/zh-hant", hreflang: "zh-Hant", ogLocale: "zh_TW" },
  { locale: "ja", prefix: "/ja", hreflang: "ja", ogLocale: "ja_JP" },
  { locale: "fr", prefix: "/fr", hreflang: "fr", ogLocale: "fr_FR" },
  { locale: "de", prefix: "/de", hreflang: "de", ogLocale: "de_DE" },
  { locale: "ru", prefix: "/ru", hreflang: "ru", ogLocale: "ru_RU" },
  { locale: "es", prefix: "/es", hreflang: "es", ogLocale: "es_ES" },
];

// RSS, BlogPosting metadata, and the desktop changelog feed are projections
// of the same locale resources the pages render. Read them at build time so
// the SSR entry does not statically bundle every language.
const SITE_RESOURCES = Object.fromEntries(
  await Promise.all(
    LOCALES.map(async ({ locale }) => [
      locale,
      JSON.parse(await readFile(join(appDir, "src", "i18n", "resources", `${locale}.site.json`), "utf8")),
    ]),
  ),
);
const POSTS = Object.entries(SITE_RESOURCES.en.blog.posts).map(([slug, post]) => ({
  slug,
  date: post.date,
  text: Object.fromEntries(
    ["en", "zh", "ja"].map((locale) => {
      const localized = SITE_RESOURCES[locale].blog.posts[slug];
      return [locale, { title: localized.title, description: localized.description }];
    }),
  ),
}));
const CHANGELOG = SITE_RESOURCES.en.changelog.entries.map((entry, index) => ({
  version: entry.version,
  date: entry.date,
  ...(entry.codename ? { codename: entry.codename } : {}),
  text: Object.fromEntries(
    LOCALES.map(({ locale }) => {
      const localized = SITE_RESOURCES[locale].changelog.entries[index];
      if (localized.version !== entry.version) {
        throw new Error(`Changelog resources drifted at ${locale}/${entry.version}`);
      }
      return [locale, { summary: localized.summary, groups: localized.groups }];
    }),
  ),
}));

function localeOf(routePath) {
  return (
    LOCALES.find(({ prefix }) => prefix && (routePath === prefix || routePath.startsWith(`${prefix}/`))) ?? LOCALES[0]
  );
}

/**
 * Cloudflare Workers Static Assets serves each prerendered page from
 * `<path>/index.html`; `wrangler.jsonc` keeps `auto-trailing-slash` enabled,
 * while the generated `_redirects` below preserves the old permanent 308 from
 * the bare path to the trailing-slash form. Every absolute URL we emit
 * (canonical, hreflang, og:url, sitemap) must use the served form so crawlers
 * do not chase a redirect on each one.
 */
function canonicalUrl(routePath) {
  return routePath === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${routePath}/`;
}

/** The route path with the locale prefix stripped ("/zh/docs" -> "/docs"). */
function basePathOf(routePath) {
  const { prefix } = localeOf(routePath);
  return prefix ? routePath.slice(prefix.length) || "/" : routePath;
}

/** The locale variants of a page that actually exist as routes. */
function localeVariants(routePath) {
  const base = basePathOf(routePath);
  return LOCALES.map((entry) => ({
    ...entry,
    // The homepage variant is the bare prefix ("/zh"), not "/zh/" — route
    // paths carry no trailing slash.
    path: entry.prefix ? (base === "/" ? entry.prefix : `${entry.prefix}${base}`) : base,
  })).filter((entry) => pathSet.has(entry.path));
}

// renderToString escapes text and attributes; decode the few entities it
// emits before re-escaping the string for a new attribute context.
function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXml(value) {
  return escapeAttr(value).replace(/'/g, "&apos;");
}

/** <link rel="alternate" hreflang> tags for pages that exist in every locale. */
function alternateLinks(routePath) {
  const variants = localeVariants(routePath);
  if (variants.length < 2) return "";
  const links = variants.map(
    (entry) => `<link rel="alternate" hreflang="${entry.hreflang}" href="${canonicalUrl(entry.path)}" />`,
  );
  links.push(`<link rel="alternate" hreflang="x-default" href="${canonicalUrl(basePathOf(routePath))}" />`);
  return links.join("\n    ");
}

/** Open Graph + Twitter card tags, from the route's own title/description. */
function socialTags(routePath, title, description) {
  const currentLocale = localeOf(routePath);
  const url = canonicalUrl(routePath);
  const ogType = basePathOf(routePath).startsWith("/blog/") ? "article" : "website";
  const ogImageAlt = SITE_RESOURCES[currentLocale.locale].home.shelfAlt;
  const alternateOgLocales = localeVariants(routePath)
    .filter((entry) => entry.locale !== currentLocale.locale)
    .map((entry) => `<meta property="og:locale:alternate" content="${entry.ogLocale}" />`);
  const tags = [
    `<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}" />`,
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeAttr(ogImageAlt)}" />`,
    `<meta property="og:locale" content="${currentLocale.ogLocale}" />`,
    ...alternateOgLocales,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
  ];
  return tags.join("\n    ");
}

const TOPIC_SOFTWARE_TARGETS = {
  "/open-source-ebook-reader": {
    operatingSystem: "macOS, Windows, Linux, Android",
    downloadUrl: DOWNLOAD_URL,
    screenshot: `${SITE_ORIGIN}/screenshots/shelf-light.webp`,
  },
  "/cbz-cbr-reader": {
    operatingSystem: "macOS, Windows, Linux, Android",
    downloadUrl: DOWNLOAD_URL,
    screenshot: `${SITE_ORIGIN}/screenshots/shelf-light.webp`,
  },
  "/epub-reader-for-windows": {
    operatingSystem: "Windows",
    downloadUrl: WINDOWS_DOWNLOAD_URL,
    screenshot: `${SITE_ORIGIN}/screenshots/reader-light.webp`,
  },
  "/epub-reader-for-android": {
    operatingSystem: "Android",
    downloadUrl: ANDROID_DOWNLOAD_URL,
    screenshot: `${SITE_ORIGIN}/screenshots/android-reader-light.png`,
  },
};

/** SoftwareApplication structured data for homepages and software entry pages. */
function softwareApplicationJsonLd(routePath, description) {
  const base = basePathOf(routePath);
  const target = isHomepage(routePath)
    ? {
        operatingSystem: "macOS, Windows, Linux, Android",
        downloadUrl: DOWNLOAD_URL,
        screenshot: `${SITE_ORIGIN}/screenshots/shelf-light.webp`,
      }
    : TOPIC_SOFTWARE_TARGETS[base];
  if (!target) return "";
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description,
    url: canonicalUrl(routePath),
    image: OG_IMAGE,
    screenshot: target.screenshot,
    applicationCategory: "EducationalApplication",
    operatingSystem: target.operatingSystem,
    softwareVersion: CHANGELOG[0].version,
    license: LICENSE_URL,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    downloadUrl: target.downloadUrl,
    inLanguage: localeOf(routePath).hreflang,
  };
  return jsonLdScript(data);
}

function isHomepage(routePath) {
  return routePath === "/" || LOCALES.some(({ prefix }) => prefix === routePath);
}

/** The registered post behind a blog-article route, if this is one. */
function blogPostOf(routePath) {
  const base = basePathOf(routePath);
  if (!base.startsWith("/blog/")) return undefined;
  const slug = base.slice("/blog/".length);
  return POSTS.find((post) => post.slug === slug);
}

const ORGANIZATION = {
  "@type": "Organization",
  name: SITE_NAME,
  url: `${SITE_ORIGIN}/`,
  logo: LOGO_URL,
};

function jsonLdScript(data) {
  // \u003c keeps a literal "</script>" inside string values from closing the tag.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

/** WebSite structured data on the domain root homepage, for Google site names. */
function websiteJsonLd() {
  return jsonLdScript({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: `${SITE_ORIGIN}/`,
  });
}

/** Organization structured data, emitted next to SoftwareApplication on homepages. */
function organizationJsonLd() {
  return jsonLdScript({
    "@context": "https://schema.org",
    ...ORGANIZATION,
    sameAs: [GITHUB_URL, DISCORD_URL],
  });
}

/** BlogPosting structured data for a blog-article route. */
function blogPostingJsonLd(routePath, description, post) {
  const currentLocale = localeOf(routePath);
  return jsonLdScript({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.text[currentLocale.locale]?.title ?? post.text.en.title,
    description,
    url: canonicalUrl(routePath),
    datePublished: post.date,
    image: OG_IMAGE,
    inLanguage: currentLocale.hreflang,
    author: ORGANIZATION,
    publisher: ORGANIZATION,
  });
}

const DOCS_LEAF_LABELS = {
  "/docs/install": "install",
  "/docs/getting-started": "gettingStarted",
  "/docs/plugins/develop": "pluginsDevelop",
  "/docs/plugins/capabilities": "pluginsCapabilities",
  "/docs/plugins/api": "pluginsApi",
  "/docs/plugins/publishing": "pluginsPublishing",
};

/** BreadcrumbList structured data for /docs and /blog hierarchies. */
function breadcrumbJsonLd(routePath, post) {
  const { locale, prefix } = localeOf(routePath);
  const base = basePathOf(routePath);
  const site = SITE_RESOURCES[locale];
  const homePath = prefix || "/";
  const crumbs = [{ name: SITE_NAME, path: homePath }];

  if (base === "/docs") {
    crumbs.push({ name: site.chrome.docs, path: routePath });
  } else if (base.startsWith("/docs/")) {
    crumbs.push({ name: site.chrome.docs, path: `${prefix}/docs` });
    if (base === "/docs/plugins") {
      crumbs.push({ name: site.docsNav.labels.pluginsOverview, path: routePath });
    } else if (base.startsWith("/docs/plugins/")) {
      crumbs.push({ name: site.docsNav.labels.pluginsOverview, path: `${prefix}/docs/plugins` });
      const labelKey = DOCS_LEAF_LABELS[base];
      if (labelKey) crumbs.push({ name: site.docsNav.labels[labelKey], path: routePath });
    } else {
      const labelKey = DOCS_LEAF_LABELS[base];
      if (labelKey) crumbs.push({ name: site.docsNav.labels[labelKey], path: routePath });
    }
  } else if (base === "/blog") {
    crumbs.push({ name: site.chrome.blog, path: routePath });
  } else if (post) {
    crumbs.push({ name: site.chrome.blog, path: `${prefix}/blog` });
    crumbs.push({ name: post.text[locale]?.title ?? post.text.en.title, path: routePath });
  } else {
    return "";
  }

  return jsonLdScript({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: canonicalUrl(crumb.path),
    })),
  });
}

function resourcePreloads(routePath) {
  const tags = [];
  if (localeOf(routePath).locale === "ru") {
    tags.push(
      '<link rel="preload" as="font" type="font/woff2" href="/fonts/literata-normal-cyrillic.woff2" crossorigin />',
    );
  }
  if (isHomepage(routePath)) {
    tags.push(
      `<link rel="preload" as="image" href="${SHELF_SCREENSHOT_LIGHT}" media="(prefers-color-scheme: light)" fetchpriority="high" />`,
      `<link rel="preload" as="image" href="${SHELF_SCREENSHOT_DARK}" media="(prefers-color-scheme: dark)" fetchpriority="high" />`,
    );
  }
  return tags.join("\n    ");
}

const searchPages = [];
for (const routePath of paths) {
  let body = await render(routePath);
  // A redirect or router failure during SSR yields an empty string; shipping
  // that would leave crawlers an empty `<div id="root">`.
  if (!body.trim()) throw new Error(`Prerender produced an empty document for ${routePath}`);

  // <HeadContent /> emits the route's <title>/<meta name="description"> where
  // it sits in the body markup; lift them into the document head so parsers
  // and previews see per-page metadata, and drop the in-body copies (plus
  // React's automatic preload of the small header icon, so hero screenshots win).
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "";
  const description = body.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/)?.[1] ?? "";
  body = body
    .replace(/<title[^>]*>[\s\S]*?<\/title>/g, "")
    .replace(/<meta[^>]*name="description"[^>]*>/g, "")
    .replace(/<link rel="preload" as="image" href="\/icon-64\.png[^"]*"\s*\/?>/g, "");

  let html = template.replace('<div id="root"></div>', () => {
    return `<div id="root">${body}</div>`;
  });
  if (title) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`);
  }
  if (description) {
    // `data-prerender` marks the static copy for removal at hydration, since
    // the router re-emits its own description (see main.tsx).
    html = html.replace(
      /<meta[^>]*name="description"[^>]*\/>/,
      () => `<meta name="description" content="${description}" data-prerender />`,
    );
  }
  html = html.replace('<html lang="en">', () => {
    return `<html lang="${localeOf(routePath).hreflang}">`;
  });

  const plainTitle = decodeEntities(title);
  const plainDescription = decodeEntities(description);
  const post = blogPostOf(routePath);
  const headTags = [
    resourcePreloads(routePath),
    `<link rel="canonical" href="${canonicalUrl(routePath)}" />`,
    `<link rel="alternate" type="application/rss+xml" title="${escapeAttr(`${SITE_NAME} Blog`)}" href="${FEED_URL}" />`,
    alternateLinks(routePath),
    socialTags(routePath, plainTitle, plainDescription),
    post ? `<meta property="article:published_time" content="${post.date}" />` : "",
    post ? blogPostingJsonLd(routePath, plainDescription, post) : "",
    breadcrumbJsonLd(routePath, post),
    softwareApplicationJsonLd(routePath, plainDescription),
    routePath === "/" ? websiteJsonLd() : "",
    isHomepage(routePath) ? organizationJsonLd() : "",
  ].filter(Boolean);
  html = html.replace("</head>", () => `    ${headTags.join("\n    ")}\n  </head>`);

  const outFile = routePath === "/" ? join(distDir, "index.html") : join(distDir, routePath.slice(1), "index.html");
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html);
  searchPages.push({ url: canonicalUrl(routePath), hash: await contentHash(html) });
  console.log(`prerendered ${routePath} -> ${relative(appDir, outFile)}`);
}

// Every prerendered page, with its language variants, in one sitemap. The
// static robots.txt in public/ points crawlers at it.
const sitemapEntries = paths.map((routePath) => {
  const variants = localeVariants(routePath);
  const links =
    variants.length < 2
      ? []
      : [
          ...variants.map(
            (entry) =>
              `    <xhtml:link rel="alternate" hreflang="${entry.hreflang}" href="${escapeXml(canonicalUrl(entry.path))}"/>`,
          ),
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(canonicalUrl(basePathOf(routePath)))}"/>`,
        ];
  return ["  <url>", `    <loc>${escapeXml(canonicalUrl(routePath))}</loc>`, ...links, "  </url>"].join("\n");
});
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...sitemapEntries,
  "</urlset>",
  "",
].join("\n");
await writeFile(join(distDir, "sitemap.xml"), sitemap);
console.log(`wrote sitemap.xml (${paths.length} URLs)`);
await writeFile(
  join(distDir, "search-manifest.json"),
  JSON.stringify(validateManifest({ version: 1, pages: searchPages })),
);

// Workers Static Assets' automatic directory redirect is temporary (307),
// while the Pages deployment this replaces used a permanent 308. Keep that
// SEO contract explicitly for every prerendered route and the standalone
// sync-login trampoline. Future routes join this list automatically.
const redirects = [
  "# Generated by scripts/prerender.mjs — do not edit dist/_redirects.",
  ...paths.filter((routePath) => routePath !== "/").map((routePath) => `${routePath} ${routePath}/ 308`),
  "/sync/login /sync/login/ 308",
  "",
].join("\n");
await writeFile(join(distDir, "_redirects"), redirects);
console.log(`wrote _redirects (${paths.length} permanent redirects)`);

// English blog feed; every page's head carries the discovery link.
const feedItems = [...POSTS]
  .sort((a, b) => b.date.localeCompare(a.date))
  .map((post) => {
    const url = canonicalUrl(`/blog/${post.slug}`);
    return [
      "    <item>",
      `      <title>${escapeXml(post.text.en.title)}</title>`,
      `      <link>${escapeXml(url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>`,
      `      <description>${escapeXml(post.text.en.description)}</description>`,
      "    </item>",
    ].join("\n");
  });
const feed = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
  "  <channel>",
  `    <title>${escapeXml(`${SITE_NAME} Blog`)}</title>`,
  `    <link>${SITE_ORIGIN}/blog/</link>`,
  "    <description>Notes from building an AI-native, local-first reading app.</description>",
  "    <language>en</language>",
  `    <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml"/>`,
  ...feedItems,
  "  </channel>",
  "</rss>",
  "",
].join("\n");
await writeFile(join(distDir, "feed.xml"), feed);
console.log(`wrote feed.xml (${POSTS.length} posts)`);

// The desktop app's post-update dialog fetches this (features/update/lib/
// changelog-feed.ts): the same hand-written, all-locale registry the /changelog
// pages render from, as one static JSON file. Published verbatim — the client
// picks the version and locale it needs.
await writeFile(join(distDir, "changelog.json"), JSON.stringify(CHANGELOG));
console.log(`wrote changelog.json (${CHANGELOG.length} versions)`);

console.log(`prerendered ${paths.length} routes`);
