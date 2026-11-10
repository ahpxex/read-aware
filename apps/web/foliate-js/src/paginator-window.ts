// READAWARE: lay a long section out a part at a time.
//
// The paginator shows one source document per section, and a browser lays a
// document out whole: a 400 kB chapter costs the same to open at its first
// line as it does to read to its end. This module keeps most of such a
// document out of the layout tree until it is wanted.
//
// The document's flow is cut into chunks: the block children of its block
// containers, in document order. A chunk outside the window carries a
// `data-foliate-defer` marker, styled `display: none` by one injected sheet;
// no node is moved, wrapped or removed, so CFIs, annotations and links keep
// their source paths. The window is one run of consecutive chunks that are
// laid out. It opens around the place the reader is taken to and only ever
// grows, a batch at a time, until it holds the whole document. From then on
// nothing of this module is left in the page.
//
// What the callers rely on:
//
// - Paginated flow fills columns in order, so a page is only right when
//   everything before it is laid out: there the window starts at the
//   document's first chunk and grows forward only.
// - In scrolled flow blocks do not depend on what precedes them, so the
//   window may start anywhere and grow both ways. Growing it backward moves
//   what is on screen; the paginator holds the reader's place across it.
// - Lists and tables are never cut (their numbering and column widths belong
//   to the whole), and neither is a container that mixes text with blocks.

const DEFER = "data-foliate-defer";
const SHEET_ID = "foliate-defer";
const SHEET = `[${DEFER}] { display: none !important; }`;

/** Containers whose block children may be laid out separately. */
const CONTAINERS = new Set(["body", "div", "section", "article", "main"]);
const MEDIA = "img, svg, video, canvas, image, object, iframe, audio";
/** What a picture counts for when text is weighed: about a short paragraph's room. */
const MEDIA_WEIGHT = 400;
/** Fewer chunks than this leave nothing worth deferring. */
const MIN_CHUNKS = 24;

/** Block-level boxes: the ones that stack in a block container. */
const blockLevel = (display: string) =>
  display === "block" ||
  display === "flow-root" ||
  display === "list-item" ||
  display === "table" ||
  display === "flex" ||
  display === "grid";

const hasText = (node: Node) => node.nodeType === 3 || node.nodeType === 4;

/**
 * Collect the chunks of `root`: its block children, descending into block
 * children that are themselves plain block containers. False when `root` is
 * not a block container whose children can be laid out one without the other.
 */
function chunksOf(root: Element, win: Window, into: Element[]): boolean {
  const blocks: Element[] = [];
  for (const node of root.childNodes) {
    if (hasText(node)) {
      // Text between the blocks belongs to a line that those blocks interrupt.
      if (node.nodeValue?.trim()) return false;
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const name = element.localName;
    if (name === "script" || name === "style" || name === "link" || name === "template") continue;
    const display = win.getComputedStyle(element).display;
    if (display === "none") continue;
    if (blockLevel(display)) {
      blocks.push(element);
      continue;
    }
    // An inline box with nothing in it (an empty link target, a stray line
    // break) joins no line of text; anything else makes this a paragraph.
    if (element.textContent?.trim() || element.matches(MEDIA) || element.querySelector(MEDIA)) return false;
  }
  for (const block of blocks) {
    const before = into.length;
    if (CONTAINERS.has(block.localName) && block.childElementCount > 1 && chunksOf(block, win, into)) continue;
    // Not a container to cut: whatever its own blocks added is taken back.
    into.length = before;
    into.push(block);
  }
  return true;
}

export class LayoutWindow {
  /** Chunks in document order. */
  readonly #chunks: Element[];
  /** `#before[i]` is the weight of every chunk before `i`; one entry more than there are chunks. */
  readonly #before: number[];
  readonly #positions = new Map<Element, number>();
  /** The laid-out run is `[#from, #to)`. */
  #from = 0;
  #to = 0;

  private constructor(chunks: Element[], weights: number[]) {
    this.#chunks = chunks;
    this.#before = [0];
    for (const [index, chunk] of chunks.entries()) {
      this.#positions.set(chunk, index);
      this.#before.push(this.#before[index]! + weights[index]!);
    }
    this.#to = chunks.length;
  }

  /**
   * A window over `doc`, or null when the document is too short to be worth
   * one (`least` is the weight below which it is laid out whole) or its flow
   * cannot be cut. Reads computed styles; call it once they are in place.
   */
  static over(doc: Document, least: number): LayoutWindow | null {
    const win = doc.defaultView;
    if (!win || !doc.body) return null;
    // Cheap, and settles most documents: a chapter of ordinary length.
    if ((doc.body.textContent?.length ?? 0) < least) return null;
    const chunks: Element[] = [];
    if (!chunksOf(doc.body, win, chunks) || chunks.length < MIN_CHUNKS) return null;
    const weights = chunks.map(
      (chunk) =>
        (chunk.textContent?.length ?? 0) +
        MEDIA_WEIGHT * (chunk.matches(MEDIA) ? 1 : chunk.querySelectorAll(MEDIA).length),
    );
    const layout = new LayoutWindow(chunks, weights);
    if (layout.weight < least) return null;
    if (!doc.getElementById(SHEET_ID)) {
      const sheet = doc.createElement("style");
      sheet.id = SHEET_ID;
      sheet.textContent = SHEET;
      (doc.head ?? doc.documentElement).append(sheet);
    }
    return layout;
  }

  /** Whether `element` is kept out of the layout tree for now. */
  static defers(element: Element): boolean {
    return element.hasAttribute(DEFER);
  }

  /** The weight of the whole document: its text, with pictures counted as text. */
  get weight() {
    return this.#before[this.#chunks.length]!;
  }
  /** The weight laid out so far, and the weight still waiting on each side. */
  get laidOut() {
    return this.#before[this.#to]! - this.#before[this.#from]!;
  }
  get waitingBefore() {
    return this.#before[this.#from]!;
  }
  get waitingAfter() {
    return this.weight - this.#before[this.#to]!;
  }
  get complete() {
    return this.#from === 0 && this.#to === this.#chunks.length;
  }
  /** The first and last chunks laid out: where the window ends in the document. */
  get first(): Element | undefined {
    return this.#chunks[this.#from];
  }
  get last(): Element | undefined {
    return this.#chunks[this.#to - 1];
  }

  /**
   * The chunk holding `node`, or the first chunk after it when it lies
   * between chunks; the chunk count when it follows them all.
   */
  indexOf(node: Node): number {
    for (let ancestor: Node | null = node; ancestor; ancestor = ancestor.parentNode) {
      const index = ancestor.nodeType === 1 ? this.#positions.get(ancestor as Element) : undefined;
      if (index !== undefined) return index;
    }
    let low = 0,
      high = this.#chunks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.#chunks[middle]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /** How `node` lies to the laid-out run: before it (-1), inside it (0) or after it (1). */
  side(node: Node): -1 | 0 | 1 {
    const index = this.indexOf(node);
    return index < this.#from ? -1 : index >= this.#to ? 1 : 0;
  }

  /** Whether content from `start` on (the document's start when omitted) still waits before the run. */
  waitsBefore(start?: Node): boolean {
    return (start ? this.indexOf(start) : 0) < this.#from;
  }
  /** Whether content up to `end` (the document's end when omitted) still waits after the run. */
  waitsAfter(end?: Node): boolean {
    return this.#to < (end ? this.indexOf(end) : this.#chunks.length);
  }

  /**
   * Open the window on the chunks around `index`: `before` and `after` are
   * the weights to lay out on each side of it. Everything else is deferred.
   * A window opens once, over a document that is laid out whole.
   */
  open(index: number, before: number, after: number) {
    const count = this.#chunks.length;
    const at = Math.max(0, Math.min(count - 1, index));
    let from = at,
      to = at + 1;
    while (from > 0 && this.#before[at]! - this.#before[from]! < before) from--;
    while (to < count && this.#before[to]! - this.#before[at + 1]! < after) to++;
    for (let i = 0; i < from; i++) this.#chunks[i]!.setAttribute(DEFER, "");
    for (let i = to; i < count; i++) this.#chunks[i]!.setAttribute(DEFER, "");
    this.#from = from;
    this.#to = to;
  }

  /**
   * Bring `weight` more of the document into the layout tree at the window's
   * start (`dir` -1) or end (1). Returns the chunks that joined, in document
   * order; none when that side is exhausted.
   */
  grow(dir: -1 | 1, weight: number): Element[] {
    const count = this.#chunks.length;
    if (dir > 0) {
      const from = this.#to;
      let to = from;
      while (to < count && (to === from || this.#before[to]! - this.#before[from]! < weight)) to++;
      return this.#admit(from, to);
    }
    const to = this.#from;
    let from = to;
    while (from > 0 && (from === to || this.#before[to]! - this.#before[from]! < weight)) from--;
    return this.#admit(from, to);
  }

  /** Grow the window until it holds chunk `index`, with `margin` more weight beyond it. */
  growTo(index: number, margin: number): Element[] {
    const count = this.#chunks.length;
    const at = Math.max(0, Math.min(count - 1, index));
    if (at >= this.#to) {
      let to = at + 1;
      while (to < count && this.#before[to]! - this.#before[at + 1]! < margin) to++;
      return this.#admit(this.#to, to);
    }
    if (at < this.#from) {
      let from = at;
      while (from > 0 && this.#before[at]! - this.#before[from]! < margin) from--;
      return this.#admit(from, this.#from);
    }
    return [];
  }

  /** Lay out everything that is still waiting. */
  growToAll(): Element[] {
    return [...this.#admit(0, this.#from), ...this.#admit(this.#to, this.#chunks.length)];
  }

  #admit(from: number, to: number): Element[] {
    const joined = this.#chunks.slice(from, to);
    for (const chunk of joined) chunk.removeAttribute(DEFER);
    this.#from = Math.min(this.#from, from);
    this.#to = Math.max(this.#to, to);
    return joined;
  }
}
