export function AndroidReaderPlate() {
  return (
    <figure className="mx-auto my-10 max-w-80">
      <picture>
        <source
          media="(prefers-color-scheme: dark)"
          srcSet="/screenshots/android-reader-dark.png"
        />
        <img
          src="/screenshots/android-reader-light.png"
          alt="Pride and Prejudice open in ReadAware on Android, with the chapter text, reading progress, and reader toolbar visible."
          width={1080}
          height={2400}
          loading="lazy"
          className="block h-auto w-full border border-border-strong"
        />
      </picture>
      <figcaption className="mt-3 text-[0.9375rem] leading-normal text-fg-muted">
        ReadAware 0.5.4 on Android 16. Captured in a Pixel 7 emulator.
      </figcaption>
    </figure>
  );
}
