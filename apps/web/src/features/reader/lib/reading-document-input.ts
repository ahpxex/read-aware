import type { NativeInputBridge } from "../../../../foliate-js/src/renderer";
import { causalActor, type DomainActor } from "../../../platform/domain-actor";
import { readingRenderActor, readingRenderContext } from "./reading-render-context";

type SelectionPosition = {
  anchor: Node | null;
  anchorOffset: number;
  focus: Node | null;
  focusOffset: number;
  count: number;
};
type SelectionSource = { position: SelectionPosition; context: object; handled: boolean };
type DocumentInput = { selection?: SelectionSource; revision: object; input: object };
const documents = new WeakMap<Document, DocumentInput>();
const events = new WeakMap<Event, object>();
const focusRequests = new WeakMap<Element, object>();
const scrolls = new WeakMap<EventTarget, { x: number; y: number; context: object; input: object }>();

function position(doc: Document): SelectionPosition {
  const selection = doc.getSelection();
  return {
    anchor: selection?.anchorNode ?? null,
    anchorOffset: selection?.anchorOffset ?? 0,
    focus: selection?.focusNode ?? null,
    focusOffset: selection?.focusOffset ?? 0,
    count: selection?.rangeCount ?? 0,
  };
}
function equal(a: SelectionPosition, b: SelectionPosition): boolean {
  return (
    a.anchor === b.anchor &&
    a.anchorOffset === b.anchorOffset &&
    a.focus === b.focus &&
    a.focusOffset === b.focusOffset &&
    a.count === b.count
  );
}
function documentOf(target: EventTarget | null): Document | undefined {
  if (!target || !("nodeType" in target)) return;
  return target.nodeType === 9 ? (target as Document) : ((target as Node).ownerDocument ?? undefined);
}
function scrollPosition(target: EventTarget | null) {
  const doc = documentOf(target);
  if (!doc || !target) return;
  const element = target === doc ? (doc.scrollingElement ?? doc.documentElement) : (target as Element);
  return { x: element.scrollLeft, y: element.scrollTop };
}

/** One exact DOM sample per document. Explicit input invalidates old samples;
 * there is no global current actor or timing-based attribution window. */
function state(doc: Document): DocumentInput {
  const previous = documents.get(doc);
  if (previous) return previous;
  const value: DocumentInput = { revision: {}, input: {} };
  documents.set(doc, value);
  const input = () => {
    value.selection = undefined;
    value.revision = {};
    value.input = {};
  };
  for (const name of ["pointerdown", "touchstart", "keydown", "wheel"])
    doc.addEventListener(name, input, { capture: true, passive: true });
  // Capture before Foliate's bubble listener schedules its focus animation.
  doc.addEventListener(
    "focusin",
    (event) => {
      readingInputContext(event);
    },
    true,
  );
  return value;
}

export function rememberReadingSelection(doc: Document, context: object, handled = false): void {
  const current = state(doc);
  current.selection = { position: position(doc), context, handled };
  current.revision = {};
}

export function acknowledgeReadingSelection(doc: Document, origin: DomainActor): void {
  rememberReadingSelection(doc, readingRenderContext(origin), true);
}

export function readingInputContext(event: Event): object {
  const cached = events.get(event);
  if (cached) return cached;
  const doc = documentOf(event.target),
    current = doc ? state(doc) : undefined;
  let context: object | undefined;
  if (event.type === "focusin" && event.target && "nodeType" in event.target) {
    context = focusRequests.get(event.target as Element);
    if (!context && current) {
      current.selection = undefined;
      current.revision = {};
    }
  } else if (
    event.type === "selectionchange" &&
    current?.selection &&
    doc &&
    equal(current.selection.position, position(doc))
  )
    context = current.selection.context;
  else if (event.type === "scroll" && current && event.target) {
    const sample = scrolls.get(event.target),
      actual = scrollPosition(event.target);
    if (sample?.input === current.input && sample.x === actual?.x && sample.y === actual?.y) context = sample.context;
  }
  context ??= readingRenderContext("user");
  events.set(event, context);
  return context;
}

/** Capture before the native selection-settle delay. New input, another host
 * write, or a changed DOM selection makes the old timer ineligible. */
export function readingSelectionFeedback(doc: Document, event: Event) {
  const current = state(doc),
    sample = position(doc),
    context = readingInputContext(event);
  const selection = current.selection;
  const handled = !!selection?.handled && equal(selection.position, sample);
  const revision = current.revision;
  return {
    origin: readingRenderActor(context),
    handled,
    current: () => current.revision === revision && equal(sample, position(doc)),
  };
}

/** A delayed layout may clear only the selection it actually sampled. Native
 * input retires the sample even when the caret returns to the same position. */
export function readingSelectionUnchanged(doc: Document): () => boolean {
  const current = state(doc),
    revision = current.revision,
    sample = position(doc);
  return () => current.revision === revision && equal(sample, position(doc));
}

/** Focus only the supplied host element. Capture exact synchronous effects on
 * the target and formerly focused document; nested focus supersedes old work. */
export function focusWithReadingSource(element: HTMLElement, source: DomainActor = "user"): void {
  focusWithContext(element, readingRenderContext(causalActor(source)), () => element.focus({ preventScroll: true }));
}

function focusWithContext(element: Element, context: object, focus: () => void): void {
  const docs = new Set<Document>([element.ownerDocument]);
  let active = element.ownerDocument.activeElement;
  while (active?.localName === "iframe") {
    let inner: Document | null;
    try {
      inner = (active as HTMLIFrameElement).contentDocument;
    } catch {
      break;
    }
    if (!inner || docs.has(inner)) break;
    docs.add(inner);
    active = inner.activeElement;
  }
  const affected = [...docs].map((doc) => {
    const current = state(doc),
      revision = {};
    current.revision = revision;
    const targets = new Set<EventTarget>([doc]);
    for (const start of [doc.activeElement, element.ownerDocument === doc ? element : null]) {
      for (let node = start; node; node = node.parentElement) targets.add(node);
    }
    return {
      doc,
      current,
      revision,
      input: current.input,
      selection: position(doc),
      scroll: [...targets].map((target) => ({ target, before: scrollPosition(target) })),
    };
  });
  focusRequests.set(element, context);
  try {
    focus();
  } finally {
    if (focusRequests.get(element) === context) focusRequests.delete(element);
    for (const item of affected) {
      if (item.current.revision !== item.revision) {
        // A nested operation that still owns the actual selection wins. Some
        // browsers finish the outer focus's caret movement after nested focus
        // listeners return: that later, different DOM effect belongs to outer.
        if (
          item.current.input !== item.input ||
          (item.current.selection && equal(item.current.selection.position, position(item.doc)))
        )
          continue;
      }
      if (!equal(item.selection, position(item.doc))) rememberReadingSelection(item.doc, context);
      for (const { target, before } of item.scroll) {
        const after = scrollPosition(target);
        if (after && before && (after.x !== before.x || after.y !== before.y))
          scrolls.set(target, { ...after, context, input: item.current.input });
      }
    }
  }
}

export const readingNativeInput: NativeInputBridge = {
  context: readingInputContext,
  selectionChanged: rememberReadingSelection,
  ownsSelection: (doc, event) => readingSelectionFeedback(doc, event).handled,
  focusDocument: (doc, context) =>
    focusWithContext(doc.activeElement ?? doc.body, context, () => doc.defaultView?.focus()),
};
