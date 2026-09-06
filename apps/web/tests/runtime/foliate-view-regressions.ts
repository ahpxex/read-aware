import type { Book, ResolvedNavigation } from '../../foliate-js/src/book';
import type { DrawAnnotationDetail, LinkDetail, View } from '../../foliate-js/src/view';
import type { FootnoteRenderDetail } from '../../foliate-js/src/footnotes';

type Modules = {
  view: typeof import('../../foliate-js/src/view');
  footnotes: typeof import('../../foliate-js/src/footnotes');
  media: typeof import('../../foliate-js/src/media-overlay');
};
type Result = { name: string; passed: boolean; details?: string };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const equal = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
};

export async function runViewRegressions(modules: Modules): Promise<Result[]> {
  if (!('__TAURI_INTERNALS__' in window)) throw new Error('Run inside Tauri');
  const results: Result[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, details: String(error) }); }
  };
  const mount = (view = new modules.view.View()) => {
    view.style.cssText = 'display:block;position:fixed;left:0;top:0;width:900px;height:600px;opacity:0;pointer-events:none;z-index:-1';
    document.body.append(view);
    return view;
  };
  const fixture = (texts = ['<p>First needle</p>', '<p id="target">Second needle</p>']) => {
    const pages = texts.map(text => `<!doctype html><html><body>${text}</body></html>`);
    const urls = pages.map(page => URL.createObjectURL(new Blob([page], { type: 'text/html' })));
    const releases = urls.map(() => 0);
    const book: Book = { metadata: { language: 'ko' }, sections: urls.map((url, index) => ({
      id: index, size: 50, load: () => url, unload: () => { releases[index]++; },
      createDocument: () => new DOMParser().parseFromString(pages[index], 'text/html'),
    })), destroy: () => urls.forEach(url => URL.revokeObjectURL(url)) };
    return { book, releases };
  };
  const content = (view: View) => {
    const result = view.renderer?.getContents()[0];
    if (!result) throw new Error('Missing native content');
    return result;
  };

  await check('View awaits async navigation, accepts resolved targets and discards superseded hrefs', async () => {
    const { book } = fixture();
    const slow = deferred<ResolvedNavigation>();
    book.resolveHref = href => href === 'slow' ? slow.promise : Promise.resolve({ index: 1 });
    const view = mount();
    try {
      await view.open(book);
      await view.init({ lastLocation: 'fast' });
      equal(content(view).index, 1);
      const pending = view.goTo('slow');
      await view.goTo({ index: 0, anchor: 0 });
      slow.resolve({ index: 1 });
      equal(await pending, undefined);
      equal(content(view).index, 0);
      equal(await view.goTo(999), undefined);
      await view.goToFraction(0);
      equal(content(view).index, 0);
      equal(view.language.isCJK, true);
    } finally { await view.close(); view.remove(); await book.destroy?.(); }
  });

  await check('View reports failed navigation without adding false history or losing its current page', async () => {
    const { book } = fixture();
    book.sections[1].load = () => { throw new Error('Expected navigation failure'); };
    const view = mount();
    try {
      await view.open(book);
      await view.goTo(0);
      let rejected = false;
      try { await view.goTo(1); } catch { rejected = true; }
      equal(rejected, true);
      equal(view.history.canGoBack, false);
      equal(content(view).index, 0);
    } finally { await view.close(); view.remove(); await book.destroy?.(); }
  });

  for (const { name, flow, style } of [
    { name: 'scrolled', flow: 'scrolled', style: '' },
    { name: 'paginated', flow: 'paginated', style: '' },
    { name: 'RTL paginated', flow: 'paginated', style: 'direction: rtl;' },
    { name: 'vertical paginated', flow: 'paginated', style: 'writing-mode: vertical-rl;' },
  ]) await check(`restoring a ${name} CFI repeatedly preserves the first visible text`, async () => {
    const { book } = fixture([`<style>body { font: 18px/30px monospace; ${style} } p { margin: 0; }</style><p>${'Readable words on a stable line. '.repeat(800)}</p>`]);
    const view = mount();
    try {
      await view.open(book);
      view.renderer?.setAttribute('flow', flow);
      await view.goToFraction(0.3);
      const initial = view.lastLocation;
      if (!initial) throw new Error('Missing initial reading location');
      const startOffset = initial.range.startOffset;
      for (let attempt = 0; attempt < 4; attempt++) {
        const cfi = view.lastLocation?.cfi;
        if (!cfi) throw new Error('Missing saved CFI');
        await view.close();
        await view.open(book);
        view.renderer?.setAttribute('flow', flow);
        await view.init({ lastLocation: cfi });
        equal(view.lastLocation?.range.startOffset, startOffset);
      }
    } finally { await view.close(); view.remove(); await book.destroy?.(); }
  });

  await check('View search draws and clears typed annotations without TOC metadata', async () => {
    const { book } = fixture();
    const view = mount();
    try {
      await view.open(book);
      await view.goTo(0);
      const results = [];
      for await (const result of view.search({ query: 'needle', index: 0 })) results.push(result);
      equal(results.length, 2);
      equal(results.at(-1), 'done');
      const layer = content(view).overlayer;
      if (!layer || !layer.element.children.length) throw new Error('Search did not draw a highlight');
      view.clearSearch();
      equal(layer.element.children.length, 0);
      const doc = content(view).doc;
      const range = doc.createRange();
      range.selectNodeContents(doc.querySelector('p')!);
      const cfi = view.getCFI(0, range);
      let draws = 0;
      view.addEventListener('draw-annotation', event => {
        const detail = (event as CustomEvent<DrawAnnotationDetail>).detail;
        equal(detail.range.toString(), 'First needle');
        draws++;
      });
      equal((await view.addAnnotation({ value: cfi }))?.label, '');
      equal(draws, 1);
    } finally { await view.close(); view.remove(); await book.destroy?.(); }
  });

  await check('View close releases sections once and removes document link listeners', async () => {
    const { book, releases } = fixture(['<a href="second"><span>Next</span></a>', '<p>Second</p>']);
    book.resolveHref = () => ({ index: 1 });
    const view = mount();
    try {
      await view.open(book);
      await view.goTo(0);
      const doc = content(view).doc;
      let links = 0;
      view.addEventListener('link', event => { event.preventDefault(); links++; });
      doc.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      equal(links, 1);
      await view.close();
      doc.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      equal(links, 1);
      await view.close();
      equal(releases[0], 1);
      equal(view.renderer, undefined);
      equal(view.book, undefined);
    } finally { await view.close(); view.remove(); await book.destroy?.(); }
  });

  await check('Deferred outline resolution cannot reannounce a closed book location', async () => {
    const first = fixture(), second = fixture(['<p>Replacement</p>']);
    const split = deferred<[number, string]>();
    first.book.toc = [{ href: 'slow', label: 'Old chapter' }];
    first.book.splitTOCHref = () => split.promise;
    first.book.getTOCFragment = doc => doc.body;
    const view = mount();
    try {
      await view.open(first.book);
      await view.goTo(1);
      await view.open(second.book);
      let relocations = 0;
      view.addEventListener('relocate', () => { relocations++; });
      split.resolve([1, 'target']);
      await new Promise(resolve => setTimeout(resolve, 30));
      equal(relocations, 0);
      equal(view.lastLocation, null);
      await view.goTo(0);
      equal(content(view).doc.body.textContent?.trim(), 'Replacement');
    } finally { await view.close(); view.remove(); await first.book.destroy?.(); await second.book.destroy?.(); }
  });

  await check('Footnote extraction renders async cross-section references and range anchors', async () => {
    const { book } = fixture(['<a role="doc-noteref" href="note">1</a>', '<aside id="note" role="doc-footnote">A real note</aside>']);
    book.resolveHref = async () => ({ index: 1, anchor: doc => doc.getElementById('note') });
    const handler = new modules.footnotes.FootnoteHandler();
    const views: View[] = [];
    let text = '', rendered = 0;
    handler.addEventListener('before-render', event => {
      const { view } = (event as CustomEvent<{ view: View }>).detail;
      views.push(mount(view));
    });
    handler.addEventListener('render', event => {
      const detail = (event as CustomEvent<FootnoteRenderDetail>).detail;
      text = detail.target?.ownerDocument.body.textContent ?? '';
      equal(detail.type, 'footnote');
      rendered++;
    });
    try {
      const a = document.createElement('a');
      a.setAttribute('role', 'doc-noteref');
      const event = new CustomEvent<LinkDetail>('link', { detail: { a, href: 'note' }, cancelable: true });
      await handler.handle(book, event);
      equal(event.defaultPrevented, true);
      equal(text, 'A real note');
      equal(rendered, 1);
      book.resolveHref = async () => ({ index: 1, anchor: doc => {
        const range = doc.createRange(); range.selectNodeContents(doc.querySelector('aside')!); return range;
      } });
      await handler.handle(book, new CustomEvent<LinkDetail>('link', { detail: { a, href: 'note' }, cancelable: true }));
      equal(rendered, 2);
      equal(text, 'A real note');
    } finally { for (const view of views) { await view.close(); view.remove(); } await book.destroy?.(); }
  });

  await check('Media highlights await href resolution and close clears playback classes', async () => {
    const { book } = fixture();
    const overlay = new modules.media.MediaOverlay({ sections: book.sections, loadBlob: () => null }, async () => null);
    book.sections[1].mediaOverlay = { href: 'overlay.smil' };
    book.media = { activeClass: 'active', playbackActiveClass: 'playing' };
    book.getMediaOverlay = () => overlay;
    book.resolveHref = async () => ({ index: 1, anchor: doc => doc.getElementById('target') });
    const view = mount();
    try {
      await view.open(book);
      await view.goTo(0);
      overlay.dispatchEvent(new CustomEvent('highlight', { detail: { text: 'second', begin: 0 } }));
      let element: Element | null = null;
      for (let attempt = 0; attempt < 100; attempt++) {
        element = view.renderer?.getContents()[0]?.doc.querySelector('#target.active') ?? null;
        if (element) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (!element) throw new Error('Media highlight did not reach the async target');
      equal(element.ownerDocument.documentElement.classList.contains('playing'), true);
      await view.close();
      equal(element.classList.contains('active'), false);
      equal(element.ownerDocument.documentElement.classList.contains('playing'), false);
    } finally { await view.close(); view.remove(); await book.destroy?.(); }
  });
  return results;
}
