type AppKeyDownListener = (event: KeyboardEvent) => void;

const forwardedListeners = new Set<AppKeyDownListener>();

/**
 * Listen for keyboard input from both the app window and embedded reader
 * documents. Keyboard events do not bubble out of Foliate's section iframes,
 * so the reader forwards those events through this shared channel.
 */
export function subscribeToAppKeyDown(listener: AppKeyDownListener): () => void {
  window.addEventListener("keydown", listener);
  forwardedListeners.add(listener);

  return () => {
    window.removeEventListener("keydown", listener);
    forwardedListeners.delete(listener);
  };
}

export function forwardKeyDownToApp(event: KeyboardEvent): void {
  for (const listener of forwardedListeners) listener(event);
}

type DomLikeNode = {
  nodeType?: number;
  localName?: string;
  parentElement?: DomLikeNode | null;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
};

/** Works across iframe realms, where `instanceof HTMLElement` is false. */
export function isEditableKeyTarget(target: EventTarget | null): boolean {
  let node = target as DomLikeNode | null;
  while (node?.nodeType === 1) {
    const tag = node.localName?.toLowerCase();
    if (
      node.isContentEditable ||
      tag === "input" ||
      tag === "textarea" ||
      tag === "select"
    ) {
      return true;
    }

    const contentEditable = node.getAttribute?.("contenteditable");
    if (contentEditable != null && contentEditable.toLowerCase() !== "false") {
      return true;
    }
    node = node.parentElement ?? null;
  }
  return false;
}
