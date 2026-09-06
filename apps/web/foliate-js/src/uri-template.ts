// URI Template: https://datatracker.ietf.org/doc/html/rfc6570

const regex = /{([+#./;?&])?([^}]+?)}/g
const varspecRegex = /(.+?)(\*|:[1-9]\d{0,3})?$/

type Operator = { first: string; sep: string; named?: boolean; ifemp?: string; allowReserved?: boolean }
const table: Record<string, Operator> = {
    '': { first: '', sep: ',' },
    '+': { first: '', sep: ',', allowReserved: true },
    '.': { first: '.', sep: '.' },
    '/': { first: '/', sep: '/' },
    ';': { first: ';', sep: ';', named: true, ifemp: '' },
    '?': { first: '?', sep: '&', named: true, ifemp: '=' },
    '&': { first: '&', sep: '&', named: true, ifemp: '=' },
    '#': { first: '#', sep: ',', allowReserved: true },
}

// 2.4.1 Prefix Values, "Note that this numbering is in characters, not octets"
const prefix = (maxLength: number, str: string) => Array.from(str).slice(0, maxLength).join('')

export const replace = (str: string, map: ReadonlyMap<string, string>): string => str.replace(regex, (_: string, operator: string | undefined, variableList: string) => {
    const { first, sep, named, ifemp = '', allowReserved } = table[operator ?? '']
    // TODO: this isn't spec compliant
    const encode = allowReserved ? encodeURI : encodeURIComponent
    const values = variableList.split(',').flatMap(varspec => {
        const match = varspec.match(varspecRegex)
        if (!match) return []
        const [, name, modifier] = match
        let value = map.get(name)
        if (value === undefined) return []
        if (modifier?.startsWith(':')) {
            const maxLength = parseInt(modifier.slice(1))
            value = prefix(maxLength, value)
        }
        const encoded = encode(value)
        return [named ? encodeURIComponent(name) + (encoded ? '=' + encoded : ifemp) : encoded]
    })
    return values.length ? first + values.join(sep) : ''
})

export const getVariables = (str: string): Set<string> => new Set(Array.from(str.matchAll(regex),
    ([,, variableList]) => variableList.split(',')
        .map(varspec => varspec.match(varspecRegex)?.[1])).flat().filter((name): name is string => name !== undefined))
