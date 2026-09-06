export const unescapeHTML = (str) => {
    if (!str)
        return '';
    const textarea = document.createElement('textarea');
    textarea.innerHTML = str;
    return textarea.value;
};
export const MIME = {
    XML: 'application/xml',
    XHTML: 'application/xhtml+xml',
    HTML: 'text/html',
    CSS: 'text/css',
    SVG: 'image/svg+xml',
};
