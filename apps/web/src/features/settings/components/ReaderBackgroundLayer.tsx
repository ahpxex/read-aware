import type { ReaderPalette } from "../lib/reader-theme";

/** The reader and settings preview share image composition; text remains opaque. */
export function ReaderBackgroundLayer({ palette }: { palette: ReaderPalette }) {
  if (!palette.background) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundColor: palette.bg }}>
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url("${palette.background.url}")`,
          opacity: palette.background.opacity,
          filter: `brightness(${1 - palette.background.dim})`,
        }}
      />
    </div>
  );
}
