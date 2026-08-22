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

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(appDir, "dist");

const { render, staticPaths, POSTS, CHANGELOG } = await import(
  join(appDir, "dist-ssr", "entry-server.js")
);

const template = await readFile(join(distDir, "index.html"), "utf8");
const paths = staticPaths();
const pathSet = new Set(paths);

const SITE_ORIGIN = "https://readaware.app";
const SITE_NAME = "ReadAware";
const OG_IMAGE = `${SITE_ORIGIN}/og.jpg`;
const OG_IMAGE_ALT =
  "The ReadAware library — a grid of book covers across many languages and formats.";
const DOWNLOAD_URL = "https://github.com/ahpxex/read-aware/releases/latest";
const GITHUB_URL = "https://github.com/ahpxex/read-aware";
const DISCORD_URL = "https://discord.gg/whDrKXwHWU";
const LOGO_URL = `${SITE_ORIGIN}/favicon.png`;
const FEED_URL = `${SITE_ORIGIN}/feed.xml`;

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

function localeOf(routePath) {
  return (
    LOCALES.find(
      ({ prefix }) =>
        prefix && (routePath === prefix || routePath.startsWith(`${prefix}/`)),
    ) ?? LOCALES[0]
  );
}

/**
 * Cloudflare Pages serves each prerendered page from `<path>/index.html` and
 * 308-redirects the bare path to the trailing-slash form, so every absolute
 * URL we emit (canonical, hreflang, og:url, sitemap) must use the served
 * form — otherwise crawlers chase a redirect on each one.
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
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXml(value) {
  return escapeAttr(value).replace(/'/g, "&apos;");
}

/** <link rel="alternate" hreflang> tags for pages that exist in every locale. */
function alternateLinks(routePath) {
  const variants = localeVariants(routePath);
  if (variants.length < 2) return "";
  const links = variants.map(
    (entry) =>
      `<link rel="alternate" hreflang="${entry.hreflang}" href="${canonicalUrl(entry.path)}" />`,
  );
  links.push(
    `<link rel="alternate" hreflang="x-default" href="${canonicalUrl(basePathOf(routePath))}" />`,
  );
  return links.join("\n    ");
}

/** Open Graph + Twitter card tags, from the route's own title/description. */
function socialTags(routePath, title, description) {
  const url = canonicalUrl(routePath);
  const ogType = basePathOf(routePath).startsWith("/blog/") ? "article" : "website";
  const tags = [
    `<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}" />`,
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeAttr(OG_IMAGE_ALT)}" />`,
    `<meta property="og:locale" content="${localeOf(routePath).ogLocale}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
  ];
  return tags.join("\n    ");
}

/** SoftwareApplication structured data, emitted on each locale's homepage. */
function softwareApplicationJsonLd(routePath, description) {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description,
    url: canonicalUrl(routePath),
    image: OG_IMAGE,
    applicationCategory: "EducationalApplication",
    operatingSystem: "macOS, Windows, Linux, Android",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    downloadUrl: DOWNLOAD_URL,
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

/** Organization structured data, emitted next to SoftwareApplication on homepages. */
function organizationJsonLd() {
  return jsonLdScript({
    "@context": "https://schema.org",
    ...ORGANIZATION,
    sameAs: [GITHUB_URL, DISCORD_URL],
  });
}

/** BlogPosting structured data for a blog-article route. */
function blogPostingJsonLd(routePath, title, description, post) {
  return jsonLdScript({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: title,
    description,
    url: canonicalUrl(routePath),
    datePublished: post.date,
    image: OG_IMAGE,
    inLanguage: localeOf(routePath).hreflang,
    author: ORGANIZATION,
    publisher: ORGANIZATION,
  });
}

for (const routePath of paths) {
  let body = await render(routePath);

  // <HeadContent /> emits the route's <title>/<meta name="description"> where
  // it sits in the body markup; lift them into the document head so parsers
  // and previews see per-page metadata, and drop the in-body copies.
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "";
  const description =
    body.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/)?.[1] ?? "";
  body = body
    .replace(/<title[^>]*>[\s\S]*?<\/title>/g, "")
    .replace(/<meta[^>]*name="description"[^>]*>/g, "");

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
    `<link rel="canonical" href="${canonicalUrl(routePath)}" />`,
    `<link rel="alternate" type="application/rss+xml" title="${escapeAttr(`${SITE_NAME} Blog`)}" href="${FEED_URL}" />`,
    alternateLinks(routePath),
    socialTags(routePath, plainTitle, plainDescription),
    post
      ? `<meta property="article:published_time" content="${post.date}" />`
      : "",
    post ? blogPostingJsonLd(routePath, plainTitle, plainDescription, post) : "",
    isHomepage(routePath)
      ? softwareApplicationJsonLd(routePath, plainDescription)
      : "",
    isHomepage(routePath) ? organizationJsonLd() : "",
  ].filter(Boolean);
  html = html.replace("</head>", () => `    ${headTags.join("\n    ")}\n  </head>`);

  const outFile =
    routePath === "/"
      ? join(distDir, "index.html")
      : join(distDir, routePath.slice(1), "index.html");
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html);
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
  return [
    "  <url>",
    `    <loc>${escapeXml(canonicalUrl(routePath))}</loc>`,
    ...links,
    "  </url>",
  ].join("\n");
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
