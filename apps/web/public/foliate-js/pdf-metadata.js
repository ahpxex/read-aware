const languageMap = (value) => value !== null
    && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === 'string');
const localized = (value) => typeof value === 'string' || languageMap(value) ? value : undefined;
const text = (value) => typeof value === 'string' ? value : undefined;
const strings = (value) => {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
        return value;
};
export const getPDFMetadata = (metadata, info) => ({
    title: localized(metadata?.get('dc:title')) ?? text(info.Title),
    author: strings(metadata?.get('dc:creator')) ?? text(info.Author),
    contributor: strings(metadata?.get('dc:contributor')),
    description: text(metadata?.get('dc:description')) ?? text(info.Subject),
    language: strings(metadata?.get('dc:language')),
    publisher: strings(metadata?.get('dc:publisher')),
    subject: strings(metadata?.get('dc:subject')),
    identifier: text(metadata?.get('dc:identifier')),
    source: strings(metadata?.get('dc:source')),
    rights: text(metadata?.get('dc:rights')),
});
