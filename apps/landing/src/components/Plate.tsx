// Cache-buster for the retaken screenshot set (bump when replacing the files).
const SHOT_VERSION = "?v=043";

/**
 * A screenshot printed as a plate: a hairline frame does the separating, and a
 * plain caption says what it is. No shadow, no border-radius, no figure number.
 * Every shot exists in a light and a dark take (`<base>-light.webp` /
 * `<base>-dark.webp`); the <picture> serves whichever matches the visitor's
 * color scheme, so the app in the pictures always wears the page's palette.
 */
export function Plate({
  base,
  alt,
  caption,
  eager = false,
}: {
  base: string;
  alt: string;
  caption: string;
  eager?: boolean;
}) {
  return (
    <figure className="m-0">
      <picture>
        <source
          media="(prefers-color-scheme: dark)"
          srcSet={`/screenshots/${base}-dark.webp${SHOT_VERSION}`}
        />
        <img
          src={`/screenshots/${base}-light.webp${SHOT_VERSION}`}
          alt={alt}
          width={2400}
          height={1600}
          loading={eager ? "eager" : "lazy"}
          className="block w-full border border-border-strong"
        />
      </picture>
      <figcaption className="mt-3 text-[0.9375rem] italic leading-normal text-fg-muted">
        {caption}
      </figcaption>
    </figure>
  );
}
