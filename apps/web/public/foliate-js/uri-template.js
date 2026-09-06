// URI Template: https://datatracker.ietf.org/doc/html/rfc6570
const regex = /{([+#./;?&])?([^}]+?)}/g;
const varspecRegex = /(.+?)(\*|:[1-9]\d{0,3})?$/;
const table = {
    '': { first: '', sep: ',' },
    '+': { first: '', sep: ',', allowReserved: true },
    '.': { first: '.', sep: '.' },
    '/': { first: '/', sep: '/' },
    ';': { first: ';', sep: ';', named: true, ifemp: '' },
    '?': { first: '?', sep: '&', named: true, ifemp: '=' },
    '&': { first: '&', sep: '&', named: true, ifemp: '=' },
    '#': { first: '#', sep: ',', allowReserved: true },
};
// 2.4.1 Prefix Values, "Note that this numbering is in characters, not octets"
const prefix = (maxLength, str) => Array.from(str).slice(0, maxLength).join('');
export const replace = (str, map) => str.replace(regex, (_, operator, variableList) => {
    const { first, sep, named, ifemp = '', allowReserved } = table[operator ?? ''];
    // TODO: this isn't spec compliant
    const encode = allowReserved ? encodeURI : encodeURIComponent;
    const values = variableList.split(',').flatMap(varspec => {
        const match = varspec.match(varspecRegex);
        if (!match)
            return [];
        const [, name, modifier] = match;
        let value = map.get(name);
        if (value === undefined)
            return [];
        if (modifier?.startsWith(':')) {
            const maxLength = parseInt(modifier.slice(1));
            value = prefix(maxLength, value);
        }
        const encoded = encode(value);
        return [named ? encodeURIComponent(name) + (encoded ? '=' + encoded : ifemp) : encoded];
    });
    return values.length ? first + values.join(sep) : '';
});
export const getVariables = (str) => new Set(Array.from(str.matchAll(regex), ([, , variableList]) => variableList.split(',')
    .map(varspec => varspec.match(varspecRegex)?.[1])).flat().filter((name) => name !== undefined));
