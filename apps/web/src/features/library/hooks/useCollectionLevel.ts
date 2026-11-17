import { useLayoutEffect, useRef, useState, type RefObject } from "react";

const scrollerOf = (root: RefObject<HTMLElement | null>) =>
  root.current?.closest<HTMLElement>(".ra-scrollarea") ?? null;

/**
 * Moving between the shelf and one of its collections is a page change, so it
 * reads like one: the incoming level enters with the page motion, a
 * collection opens at its top, and returning puts the shelf back where the
 * reader left it. The shelf and the collection share the app's scroll area
 * (the `.ra-scrollarea` hosting `root`), which would otherwise carry one
 * level's offset into the other.
 *
 * Returns whether the level has changed since the view mounted: the first
 * level keeps the view's own entrance, and only a move between levels plays
 * the page motion.
 */
export function useCollectionLevel(collectionId: string | null, root: RefObject<HTMLElement | null>) {
  const [level, setLevel] = useState(collectionId);
  const [moved, setMoved] = useState(false);
  const [shelfOffset, setShelfOffset] = useState(0);
  if (level !== collectionId) {
    setLevel(collectionId);
    setMoved(true);
    // Read while the page still holds the shelf: once the collection is in
    // the DOM, the scroll area has already clamped to its shorter height.
    if (level === null) setShelfOffset(scrollerOf(root)?.scrollTop ?? 0);
  }

  const previous = useRef(collectionId);
  useLayoutEffect(() => {
    if (previous.current === collectionId) return;
    previous.current = collectionId;
    const scroller = scrollerOf(root);
    if (scroller) scroller.scrollTop = collectionId === null ? shelfOffset : 0;
  }, [collectionId, root, shelfOffset]);

  return moved;
}
