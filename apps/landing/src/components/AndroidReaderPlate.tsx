export function AndroidReaderPlate({
  locale = "en",
}: {
  locale?: "en" | "zh";
}) {
  return (
    <figure className="mx-auto my-10 max-w-80">
      <picture>
        <source
          media="(prefers-color-scheme: dark)"
          srcSet="/screenshots/android-reader-dark.png"
        />
        <img
          src="/screenshots/android-reader-light.png"
          alt={
            locale === "zh"
              ? "Android 版 ReadAware 正在阅读《傲慢与偏见》，显示正文、阅读进度和工具栏。"
              : "Pride and Prejudice open in ReadAware on Android, with the chapter text, reading progress, and reader toolbar visible."
          }
          width={1080}
          height={2400}
          loading="lazy"
          className="block h-auto w-full border border-border-strong"
        />
      </picture>
      <figcaption className="mt-3 text-[0.9375rem] leading-normal text-fg-muted">
        {locale === "zh"
          ? "ReadAware 0.5.4，Android 16，Pixel 7 模拟器实拍。"
          : "ReadAware 0.5.4 on Android 16. Captured in a Pixel 7 emulator."}
      </figcaption>
    </figure>
  );
}
