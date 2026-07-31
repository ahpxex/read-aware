import { describe, expect, test } from "bun:test";
import {
  buildAppSkinCss,
  buildPluginFontFaceCss,
  findRegisteredByRef,
  isPluginRef,
  isPluginThemeColor,
  parsePluginRef,
  toPluginRef,
  validateFontContributions,
  validateThemeContributions,
} from "./plugin-theme";
import { parseManifestJson } from "./manifest";

describe("color grammar", () => {
  test("accepts hex and functional colors", () => {
    for (const value of [
      "#fff",
      "#f5f1e8",
      "#f5f1e880",
      "rgb(28 25 23 / 0.42)",
      "rgba(168, 162, 158, 0.34)",
      "hsl(30 20% 95%)",
      "hsla(30, 20%, 95%, 0.5)",
    ]) {
      expect(isPluginThemeColor(value)).toBe(true);
    }
  });

  test("rejects everything that could escape a declaration", () => {
    for (const value of [
      "red",
      "var(--color-fg)",
      "url(https://evil.example/x)",
      "rgb(0,0,0); background: url(https://evil.example)",
      "#fff; }",
      "linear-gradient(#fff, #000)",
      "expression(alert(1))",
      "",
      42,
      null,
    ]) {
      expect(isPluginThemeColor(value)).toBe(false);
    }
  });
});

describe("plugin refs", () => {
  test("round-trips and parses", () => {
    const ref = toPluginRef("editorial-themes", "nocturne");
    expect(ref).toBe("plugin:editorial-themes:nocturne");
    expect(isPluginRef(ref)).toBe(true);
    expect(parsePluginRef(ref)).toEqual({
      pluginId: "editorial-themes",
      partId: "nocturne",
    });
  });

  test("rejects malformed refs", () => {
    for (const value of ["plugin:", "plugin:only-one", "plugin:UP:case", "curated:inter", "plugin:a:b:c"]) {
      expect(isPluginRef(value)).toBe(false);
    }
  });

  test("findRegisteredByRef matches plugin and part ids", () => {
    const items = [
      { pluginId: "p1", id: "a" },
      { pluginId: "p2", id: "a" },
    ];
    expect(findRegisteredByRef("plugin:p2:a", items)).toBe(items[1]);
    expect(findRegisteredByRef("plugin:p3:a", items)).toBeNull();
    expect(findRegisteredByRef("not-a-ref", items)).toBeNull();
  });
});

const VALID_THEME = {
  id: "nocturne",
  name: "Nocturne",
  polarity: "dark",
  app: { paper: "#14171e", fg: "#e3e6ec" },
  reader: {
    palette: {
      bg: "#161a22",
      text: "#ccd2dd",
      selection: "rgba(154, 162, 177, 0.28)",
      rule: "rgba(204, 210, 221, 0.18)",
      faint: "rgba(204, 210, 221, 0.07)",
      muted: "rgba(204, 210, 221, 0.55)",
    },
    typography: { fontFamily: "plugin:garamond", fontSize: "large" },
  },
};

const VALID_FONT = {
  id: "garamond",
  family: "EB Garamond",
  kind: "serif",
  files: [{ path: "assets/garamond-400.woff2", weight: 400 }],
};

describe("validateThemeContributions", () => {
  const fontIds = new Set(["garamond"]);

  test("accepts a complete theme", () => {
    const [theme] = validateThemeContributions([VALID_THEME], fontIds);
    expect(theme.id).toBe("nocturne");
    expect(theme.app?.paper).toBe("#14171e");
    expect(theme.reader?.palette.bg).toBe("#161a22");
    expect(theme.reader?.typography?.fontFamily).toBe("plugin:garamond");
  });

  test("rejects unknown app tokens", () => {
    expect(() =>
      validateThemeContributions(
        [{ ...VALID_THEME, app: { accent: "#ff0000" } }],
        fontIds,
      ),
    ).toThrow(/unknown app token/);
  });

  test("rejects invalid colors", () => {
    expect(() =>
      validateThemeContributions(
        [{ ...VALID_THEME, app: { paper: "url(https://evil)" } }],
        fontIds,
      ),
    ).toThrow(/not a valid color/);
  });

  test("rejects an incomplete reader palette", () => {
    const reader = { palette: { ...VALID_THEME.reader.palette } } as {
      palette: Record<string, string>;
    };
    delete reader.palette.muted;
    expect(() =>
      validateThemeContributions([{ ...VALID_THEME, reader }], fontIds),
    ).toThrow(/"muted" is not a valid color/);
  });

  test("rejects typography referencing an undeclared font", () => {
    expect(() =>
      validateThemeContributions([VALID_THEME], new Set<string>()),
    ).toThrow(/fontFamily/);
  });

  test("rejects a theme with neither part", () => {
    expect(() =>
      validateThemeContributions(
        [{ id: "empty", name: "Empty", polarity: "light" }],
        fontIds,
      ),
    ).toThrow(/app part, a reader part/);
  });
});

describe("validateFontContributions", () => {
  test("accepts a bundled font", () => {
    const [font] = validateFontContributions([VALID_FONT]);
    expect(font.family).toBe("EB Garamond");
    expect(font.kind).toBe("serif");
  });

  test("rejects traversal and non-font paths", () => {
    for (const path of ["../outside.woff2", "/abs.woff2", "assets/.hidden.woff2", "assets/x.js", "a\\b.woff2"]) {
      expect(() =>
        validateFontContributions([{ ...VALID_FONT, files: [{ path }] }]),
      ).toThrow(/file paths/);
    }
  });

  test("rejects invalid unicode ranges", () => {
    expect(() =>
      validateFontContributions([
        { ...VALID_FONT, files: [{ path: "a.woff2", unicodeRange: "U+00;evil" }] },
      ]),
    ).toThrow(/unicode-range/);
  });

  test("strips family characters that could escape the declaration", () => {
    const [font] = validateFontContributions([
      { ...VALID_FONT, family: 'Ga"ramond;{}' },
    ]);
    expect(font.family).toBe("Garamond");
  });
});

describe("manifest gate", () => {
  const base = {
    id: "themer",
    name: "Themer",
    version: "1.0.0",
    themes: [VALID_THEME],
    fonts: [VALID_FONT],
  };

  test("themes/fonts require ui:themes", () => {
    expect(() => parseManifestJson(JSON.stringify(base))).toThrow(/ui:themes/);
  });

  test("passes with the permission declared", () => {
    const manifest = parseManifestJson(
      JSON.stringify({ ...base, permissions: ["ui:themes"] }),
    );
    expect(manifest.themes?.[0].id).toBe("nocturne");
    expect(manifest.fonts?.[0].id).toBe("garamond");
  });
});

describe("css generation", () => {
  test("buildAppSkinCss writes whitelisted tokens under the skin selector", () => {
    const css = buildAppSkinCss("plugin:p:t", { paper: "#f4ecd9", fg: "#2b241a" });
    expect(css).toContain('html[data-theme][data-skin="plugin:p:t"]');
    expect(css).toContain("--color-paper: #f4ecd9;");
    expect(css).toContain("--color-fg: #2b241a;");
    expect(css).toContain("background-color: var(--color-paper);");
  });

  test("buildPluginFontFaceCss emits one @font-face per file", () => {
    const css = buildPluginFontFaceCss(
      {
        family: "EB Garamond",
        files: [
          { path: "assets/a.woff2", weight: 400 },
          { path: "assets/b.woff2", weight: 700, style: "italic", unicodeRange: "U+0000-00FF" },
        ],
      },
      (path) => `raplugin://localhost/p/${path}`,
    );
    const faces = css.split("\n");
    expect(faces).toHaveLength(2);
    expect(faces[0]).toContain('font-family:"EB Garamond"');
    expect(faces[0]).toContain("src:url(raplugin://localhost/p/assets/a.woff2)");
    expect(faces[1]).toContain("font-style:italic");
    expect(faces[1]).toContain("unicode-range:U+0000-00FF;");
  });
});
