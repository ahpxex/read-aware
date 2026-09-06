const isPageReference = (value) => value !== null
    && typeof value === 'object' && 'num' in value && 'gen' in value
    && typeof value.num === 'number' && Number.isInteger(value.num) && value.num >= 0
    && typeof value.gen === 'number' && Number.isInteger(value.gen) && value.gen >= 0;
export const resolvePDFHref = async (pdf, href) => {
    const parsed = JSON.parse(href);
    const destination = typeof parsed === 'string' ? await pdf.getDestination(parsed) : parsed;
    if (!Array.isArray(destination))
        return;
    const ref = destination[0];
    const index = typeof ref === 'number' ? ref : isPageReference(ref) ? await pdf.getPageIndex(ref) : -1;
    if (Number.isInteger(index) && index >= 0 && index < pdf.numPages)
        return { index };
};
export const makePDFTOCItem = (item) => ({
    label: item.title,
    href: item.url ?? JSON.stringify(item.dest),
    subitems: item.items.length ? item.items.map(makePDFTOCItem) : null,
});
