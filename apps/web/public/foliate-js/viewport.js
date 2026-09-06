const dimensions = (width, height) => {
    const w = Number(width), h = Number(height);
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)
        return { width: w, height: h };
};
export const parseViewport = (value) => {
    if (!value)
        return;
    if (typeof value !== 'string')
        return dimensions(value.width, value.height);
    const parts = {};
    for (const part of value.split(/[,;\s]/).filter(Boolean)) {
        const [key, value] = part.split('=').map(value => value.trim());
        if (key && value)
            parts[key] = value;
    }
    return dimensions(parts.width, parts.height);
};
export const getViewport = (doc, viewport) => {
    if (doc.documentElement.localName === 'svg') {
        const [, , width, height] = doc.documentElement.getAttribute('viewBox')?.trim().split(/[\s,]+/) ?? [];
        const result = dimensions(width, height);
        if (result)
            return result;
    }
    const meta = parseViewport(doc.querySelector('meta[name="viewport"]')?.getAttribute('content'));
    if (meta)
        return meta;
    const fallback = parseViewport(viewport);
    if (fallback)
        return fallback;
    const img = doc.querySelector('img');
    const image = img && dimensions(img.naturalWidth, img.naturalHeight);
    if (image)
        return image;
    console.warn(new Error('Missing viewport properties'));
    return { width: 1000, height: 2000 };
};
