import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readingRuntime } from "../../../domain/reading-runtime";
import { readerImageOpen } from "../../../services/reader-image-open";
import type { ActivatedImage } from "../lib/image-activation";

type ImageView = ActivatedImage & { id: string; session: { bookId: string; sessionId: string } };

/** Native image activation and API opening share one surface and URL lifetime. */
export function useImageViewer(bookId: string | undefined) {
  const [lightboxImage, setValue] = useState<ImageView | null>(null);
  const interrupt = useRef(() => {});
  const urls = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    for (const [id, url] of urls.current) {
      if (id !== lightboxImage?.id) { URL.revokeObjectURL(url); urls.current.delete(id); }
    }
  }, [lightboxImage]);
  useEffect(() => {
    let unbind = () => {}, sessionId: string | null = null;
    let alive = true;
    const stop = readingRuntime.observe(state => {
      const id = state.status === "ready" && state.bookId === bookId ? state.sessionId : null;
      if (sessionId === id) return;
      unbind(); interrupt.current = () => {}; sessionId = id; setValue(null);
      if (id && bookId) {
        const bound = readerImageOpen.bind(id, bookId, {
          present: (viewerId, data) => {
            const src = URL.createObjectURL(data.blob);
            urls.current.set(viewerId, src);
            setValue({ id: viewerId, src, alt: data.image.alt, session: { bookId, sessionId: id } });
          },
          clear: viewerId => { if (alive) setValue(value => value?.id === viewerId ? null : value); },
        });
        unbind = bound.dispose; interrupt.current = bound.interrupt;
      }
    });
    return () => {
      alive = false; stop(); unbind(); interrupt.current = () => {};
      for (const url of urls.current.values()) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, [bookId]);
  const setLightboxImage = useCallback((image: ActivatedImage & { session: ImageView["session"] }) => {
    interrupt.current(); setValue({ ...image, id: crypto.randomUUID() });
  }, []);
  const closeLightbox = useCallback(() => { interrupt.current(); setValue(null); }, []);
  return { lightboxImage, setLightboxImage, closeLightbox };
}
