export const makeComicBook = ({ entries, loadBlob, getSize }, file) => {
    const cache = new Map();
    const urls = new Map();
    const load = (name) => {
        const cached = cache.get(name);
        if (cached)
            return cached;
        const pending = Promise.resolve().then(async () => {
            const blob = await loadBlob(name);
            if (!blob)
                throw new Error(`Comic page is missing: ${name}`);
            if (cache.get(name) !== pending)
                throw new Error('Comic page load was cancelled');
            const src = URL.createObjectURL(blob);
            const page = URL.createObjectURL(new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin: 0"><img src="${src}"></body></html>`], { type: 'text/html' }));
            urls.set(name, [src, page]);
            return page;
        }).catch(error => {
            if (cache.get(name) === pending)
                cache.delete(name);
            throw error;
        });
        cache.set(name, pending);
        return pending;
    };
    const unload = (name) => {
        urls.get(name)?.forEach?.(url => URL.revokeObjectURL(url));
        urls.delete(name);
        cache.delete(name);
    };
    const exts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.jxl', '.avif'];
    const files = entries
        .map(entry => entry.filename)
        .filter(name => exts.some(ext => name.endsWith(ext)))
        .sort(new Intl.Collator([], { numeric: true }).compare);
    if (!files.length)
        throw new Error('No supported image files in archive');
    const sections = files.map(name => ({
        id: name,
        load: () => load(name),
        unload: () => unload(name),
        size: getSize(name),
    }));
    return {
        getCover: () => loadBlob(files[0]),
        metadata: { title: file.name },
        sections,
        toc: files.map(name => ({ label: name, href: name })),
        rendition: { layout: 'pre-paginated' },
        resolveHref: (href) => ({ index: sections.findIndex(s => s.id === href) }),
        splitTOCHref: (href) => [href, null],
        getTOCFragment: (doc) => doc.documentElement,
        destroy: () => {
            for (const name of cache.keys())
                unload(name);
        },
    };
};
