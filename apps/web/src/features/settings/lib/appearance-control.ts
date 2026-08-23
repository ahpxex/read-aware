/** Shared built-in theme vocabulary consumed by Settings and picker UI. */
export type AppearanceSurface = "app" | "reader";
export type ThemePolarity = "light" | "dark";

export const BUILTIN_APPEARANCE_THEMES: readonly {
  value: string;
  surfaces: AppearanceSurface[];
  polarity: ThemePolarity | null;
}[] = [
  { value: "system", surfaces: ["app"], polarity: null },
  { value: "auto", surfaces: ["reader"], polarity: null },
  { value: "light", surfaces: ["app", "reader"], polarity: "light" },
  { value: "warm", surfaces: ["reader"], polarity: "light" },
  { value: "dark", surfaces: ["app", "reader"], polarity: "dark" },
];

export function builtinThemesFor(surface: AppearanceSurface): {
  value: string;
  polarity: ThemePolarity | null;
}[] {
  return BUILTIN_APPEARANCE_THEMES.filter((theme) =>
    theme.surfaces.includes(surface),
  ).map(({ value, polarity }) => ({ value, polarity }));
}
