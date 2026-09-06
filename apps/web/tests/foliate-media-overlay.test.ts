import { expect, test } from "bun:test";
import { MediaOverlay, type OverlayAudio } from "../foliate-js/src/media-overlay.js";
import type { BookSection } from "../foliate-js/src/book.js";
import { withDom } from "./helpers/foliate-dom.js";

class TestAudio extends EventTarget implements OverlayAudio {
  volume = 1;
  playbackRate = 1;
  currentTime = 0;
  paused = true;
  constructor(readonly src: string) { super(); }
  async play() { this.paused = false; this.dispatchEvent(new Event("playing")); }
  pause() { this.paused = true; }
}
const createOverlay = (loadBlob: (href: string) => Promise<Blob> = async () => new Blob(["audio"])) => {
  const sections: BookSection[] = ["one", "two"].map(id => ({ id: `OPS/${id}.xhtml`, size: 100,
    load: () => "", mediaOverlay: { href: `OPS/${id}.smil` } }));
  const audio: TestAudio[] = [];
  const overlay = new MediaOverlay({ sections, loadBlob }, async href => {
    const chapter = href.includes("one") ? "one" : "two";
    return new DOMParser().parseFromString(`<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq>
      <par><text src="${chapter}.xhtml#a"/><audio src="${chapter}-a.mp3" clipBegin="1" clipEnd="2"/></par>
      <par><text src="${chapter}.xhtml#b"/><audio src="${chapter}-a.mp3" clipBegin="2" clipEnd="3"/></par>
      <par><text src="${chapter}.xhtml#c"/><audio src="${chapter}-b.mp3" clipBegin="3" clipEnd="4"/></par>
    </seq></body></smil>`, "application/xml");
  }, url => { const value = new TestAudio(url); audio.push(value); return value; });
  return { overlay, audio };
};

test("media overlays navigate clips, audio files and previous sections without skipping groups", () => withDom(async () => {
  const paths: string[] = [];
  const { overlay, audio } = createOverlay(async href => { paths.push(href); return new Blob(["audio"]); });
  try {
    overlay.pause();
    await overlay.start(0);
    expect(audio.at(-1)?.currentTime).toBe(1);
    await overlay.next();
    expect(audio.at(-1)?.currentTime).toBe(2);
    await overlay.next();
    expect(paths.at(-1)).toBe("OPS/one-b.mp3");
    await overlay.next();
    expect(paths.at(-1)).toBe("OPS/two-a.mp3");
    await overlay.prev();
    expect(paths.at(-1)).toBe("OPS/one-b.mp3");
    expect(audio.at(-1)?.currentTime).toBe(3);
    expect(audio.every(value => value.paused)).toBe(true);
  } finally { overlay.stop(); }
}));

test("stopping a media overlay cancels pending audio creation and revokes existing resources", () => withDom(async () => {
  const pending = Promise.withResolvers<Blob>();
  const { overlay, audio } = createOverlay(() => pending.promise);
  const loading = overlay.start(0);
  await Promise.resolve();
  await Promise.resolve();
  overlay.stop();
  pending.resolve(new Blob(["audio"]));
  await loading;
  expect(audio).toHaveLength(0);
  await overlay.start(0);
  const url = audio[0].src;
  expect((await fetch(url)).ok).toBe(true);
  overlay.stop();
  await expect(fetch(url)).rejects.toThrow();
}));

test("media playback readiness respects pause and stale media events do not restart playback", () => withDom(async () => {
  const { overlay, audio } = createOverlay();
  try {
    await overlay.start(0);
    overlay.pause();
    audio[0].dispatchEvent(new Event("canplaythrough"));
    expect(audio[0].paused).toBe(true);
    overlay.resume();
    expect(audio[0].paused).toBe(false);
    await overlay.next();
    audio[0].dispatchEvent(new Event("ended"));
    audio[0].dispatchEvent(new Event("canplaythrough"));
    expect(audio).toHaveLength(2);
    expect(audio[0].paused).toBe(true);
  } finally { overlay.stop(); }
}));
