import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { DOWNLOADS } from "../src/lib/releases";
import { LOCALES, localizePath } from "../src/lib/i18n";

const dist = new URL("../dist/", import.meta.url);

async function inspect(path: string) {
  const html = await readFile(
    new URL(`${path.replace(/^\//, "")}index.html`, dist),
    "utf8",
  );
  const result = {
    primary: [] as string[],
    header: [] as string[],
    footer: [] as string[],
    images: [] as {
      src: string | null;
      width: string | null;
      height: string | null;
      alt: string | null;
    }[],
    sources: [] as string[],
  };
  const rewriter = new HTMLRewriter()
    .on("article > header a", {
      element(el) { result.primary.push(el.getAttribute("href") ?? ""); },
    })
    .on("header a", {
      element(el) { result.header.push(el.getAttribute("href") ?? ""); },
    })
    .on("footer a", {
      element(el) { result.footer.push(el.getAttribute("href") ?? ""); },
    })
    .on("picture img", {
      element(el) {
        result.images.push({
          src: el.getAttribute("src"),
          width: el.getAttribute("width"),
          height: el.getAttribute("height"),
          alt: el.getAttribute("alt"),
        });
      },
    })
    .on("picture source", {
      element(el) { result.sources.push(el.getAttribute("srcset") ?? ""); },
    });
  await rewriter.transform(new Response(html)).text();
  return result;
}

test.each(["android", "windows"] as const)(
  "%s topic has its own direct download in static HTML",
  async (platform) => {
    const page = await inspect(`/epub-reader-for-${platform}/`);
    expect(page.primary[0]).toBe(
      DOWNLOADS.find((entry) => entry.id === platform)?.primary?.url,
    );
  },
);

test.each(LOCALES)("%s navigation stays localized and secondary links are crawlable", async (locale) => {
  const page = await inspect(localizePath("/", locale));
  const home = localizePath("/", locale).replace(/\/$/, "") || "/";
  expect(page.header).toContain(home);
  expect(page.header).toContain(`${home}#download`);
  for (const target of ["/docs", "/pricing", "/changelog", "/privacy"]) {
    expect(page.footer).toContain(localizePath(target, locale));
  }
  expect(page.footer.some((href) => href.endsWith("/blog"))).toBe(true);
});

test("Android screenshot has both themes and reserves the actual device aspect ratio", async () => {
  const page = await inspect("/epub-reader-for-android/");
  expect(page.images).toContainEqual({
    src: "/screenshots/android-reader-light.png",
    width: "1080",
    height: "2400",
    alt: "Pride and Prejudice open in ReadAware on Android, with the chapter text, reading progress, and reader toolbar visible.",
  });
  expect(page.sources).toContain("/screenshots/android-reader-dark.png");
  for (const theme of ["light", "dark"]) {
    const png = await readFile(new URL(`screenshots/android-reader-${theme}.png`, dist));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(2400);
    expect(png.length).toBeGreaterThan(10_000);
  }
});
