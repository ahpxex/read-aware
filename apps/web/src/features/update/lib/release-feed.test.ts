import { describe, expect, test } from "bun:test";
import {
  compareVersions,
  parseVersionTag,
  pickLatestRelease,
  resolveBetaManifestUrl,
  type GithubRelease,
} from "./release-feed";

const cmp = (a: string, b: string): number => {
  const [pa, pb] = [parseVersionTag(a)!, parseVersionTag(b)!];
  return Math.sign(compareVersions(pa, pb));
};

describe("semver precedence", () => {
  test("release triples order numerically", () => {
    expect(cmp("v0.3.0", "v0.2.9")).toBe(1);
    expect(cmp("v0.3.0", "v0.10.0")).toBe(-1);
    expect(cmp("v1.0.0", "v1.0.0")).toBe(0);
  });

  test("a stable outranks every prerelease of the same triple", () => {
    expect(cmp("v0.4.0", "v0.4.0-beta.2")).toBe(1);
    expect(cmp("v0.4.0-beta.1", "v0.4.0")).toBe(-1);
  });

  test("prerelease identifiers follow SemVer §11", () => {
    expect(cmp("v1.0.0-beta.2", "v1.0.0-beta.11")).toBe(-1); // numeric, not lexical
    expect(cmp("v1.0.0-alpha", "v1.0.0-beta")).toBe(-1); // ASCII among alphanumerics
    expect(cmp("v1.0.0-1", "v1.0.0-alpha")).toBe(-1); // numeric below alphanumeric
    expect(cmp("v1.0.0-beta", "v1.0.0-beta.1")).toBe(-1); // prefix loses to longer
  });

  test("build metadata is ignored; junk tags refuse to parse", () => {
    expect(cmp("v1.0.0+build.5", "v1.0.0")).toBe(0);
    expect(parseVersionTag("nightly")).toBeNull();
    expect(parseVersionTag("v1.2")).toBeNull();
  });
});

const release = (
  tag: string,
  options: { draft?: boolean; assets?: string[] } = {},
): GithubRelease => ({
  tag_name: tag,
  draft: options.draft ?? false,
  assets: (options.assets ?? ["latest.json", "latest-android.json"]).map((name) => ({
    name,
    browser_download_url: `https://github.com/ahpxex/read-aware/releases/download/${tag}/${name}`,
  })),
});

describe("pickLatestRelease", () => {
  test("the newest beta wins while it leads by semver", () => {
    const picked = pickLatestRelease(
      [release("v0.3.1"), release("v0.4.0-beta.2"), release("v0.4.0-beta.1")],
      "latest.json",
    );
    expect(picked?.tag).toBe("v0.4.0-beta.2");
  });

  test("a stable that overtakes the betas wins — beta users get it too", () => {
    const picked = pickLatestRelease(
      [release("v0.4.0-beta.2"), release("v0.4.0")],
      "latest.json",
    );
    expect(picked?.tag).toBe("v0.4.0");
  });

  test("date order is not trusted: a back-ported older stable never wins", () => {
    // List order = most recent first by DATE; v0.3.2 was published after the beta.
    const picked = pickLatestRelease(
      [release("v0.3.2"), release("v0.4.0-beta.1")],
      "latest.json",
    );
    expect(picked?.tag).toBe("v0.4.0-beta.1");
  });

  test("drafts, unparseable tags, and manifest-less releases are skipped", () => {
    const picked = pickLatestRelease(
      [
        release("v9.9.9", { draft: true }),
        release("nightly-2026"),
        release("v0.5.0", { assets: [] }),
        release("v0.4.1"),
      ],
      "latest.json",
    );
    expect(picked?.tag).toBe("v0.4.1");
  });

  test("the asset name is per platform", () => {
    const picked = pickLatestRelease(
      [release("v0.4.0", { assets: ["latest-android.json"] })],
      "latest.json",
    );
    expect(picked).toBeNull();
  });
});

describe("resolveBetaManifestUrl", () => {
  test("returns the picked manifest URL", async () => {
    const url = await resolveBetaManifestUrl("latest.json", async () =>
      Response.json([release("v0.4.0-beta.1")]));
    expect(url).toBe(
      "https://github.com/ahpxex/read-aware/releases/download/v0.4.0-beta.1/latest.json",
    );
  });

  test("degrades to null on API failure — the caller falls back to stable", async () => {
    expect(
      await resolveBetaManifestUrl(
        "latest.json",
        async () => new Response("rate limited", { status: 403 }),
      ),
    ).toBeNull();
    expect(
      await resolveBetaManifestUrl("latest.json", async () => {
        throw new Error("offline");
      }),
    ).toBeNull();
  });
});
