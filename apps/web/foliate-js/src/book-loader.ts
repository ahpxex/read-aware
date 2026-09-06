import type { Book, BookFile } from './book.js'

export type BookInput = string | BookFile | FileSystemDirectoryEntry
export class ResponseError extends Error {}
export class NotFoundError extends Error {}
export class UnsupportedTypeError extends Error {}

const hasSignature = async (file: BookFile, signature: number[]) => {
    const bytes = new Uint8Array(await file.slice(0, signature.length).arrayBuffer())
    return signature.every((byte, index) => bytes[index] === byte)
}
const hasExtension = (file: BookFile, ...extensions: string[]) =>
    extensions.some(extension => file.name?.toLowerCase().endsWith(extension))

const makeZipLoader = async (file: BookFile) => {
    const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } = await import('./vendor/zip.js')
    configure({ useWebWorkers: false })
    // ZIP needs a Blob reader; PDF keeps its native random-access file below.
    const blob = file instanceof Blob ? file : new Blob([await file.arrayBuffer()], { type: file.type })
    const reader = new ZipReader(new BlobReader(blob))
    const entries = await reader.getEntries()
    const map = new Map(entries.map(entry => [entry.filename, entry]))
    return {
        entries,
        loadText: (name: string) => map.get(name)?.getData(new TextWriter()) ?? null,
        loadBlob: (name: string, type?: string) => map.get(name)?.getData(new BlobWriter(type)) ?? null,
        getSize: (name: string) => map.get(name)?.uncompressedSize ?? 0,
    }
}

const isFileEntry = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile
const isDirectoryEntry = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry => entry.isDirectory

export const getFileEntries = async (entry: FileSystemEntry): Promise<FileSystemFileEntry[]> => {
    if (isFileEntry(entry)) return [entry]
    if (!isDirectoryEntry(entry)) return []
    const reader = entry.createReader()
    const children: FileSystemEntry[] = []
    // A directory reader returns batches, not necessarily the entire directory.
    for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        if (!batch.length) break
        children.push(...batch)
    }
    return (await Promise.all(children.map(getFileEntries))).flat()
}

const makeDirectoryLoader = async (entry: FileSystemDirectoryEntry) => {
    const entries = await getFileEntries(entry)
    const files = await Promise.all(entries.map(async child => {
        const file = await new Promise<File>((resolve, reject) => child.file(resolve, reject))
        return [child.fullPath.slice(entry.fullPath.length + 1), file] as const
    }))
    const map = new Map(files)
    return {
        loadText: (name: string) => map.get(name)?.text() ?? null,
        loadBlob: (name: string) => map.get(name) ?? null,
        getSize: (name: string) => map.get(name)?.size ?? 0,
    }
}

const fetchFile = async (url: string): Promise<File> => {
    const response = await fetch(url)
    if (!response.ok) throw new ResponseError(`${response.status} ${response.statusText}`, { cause: response })
    const blob = await response.blob()
    return new File([blob], new URL(response.url).pathname, { type: blob.type })
}

export const makeBook = async (input: BookInput): Promise<Book> => {
    const file = typeof input === 'string' ? await fetchFile(input) : input
    if ('isDirectory' in file) {
        const { EPUB } = await import('./epub.js')
        return new EPUB(await makeDirectoryLoader(file)).init()
    }
    if (!file.size) throw new NotFoundError('File not found')
    if (await hasSignature(file, [0x50, 0x4b, 0x03, 0x04])) {
        const loader = await makeZipLoader(file)
        if (file.type === 'application/vnd.comicbook+zip' || hasExtension(file, '.cbz')) {
            const { makeComicBook } = await import('./comic-book.js')
            return makeComicBook(loader, file)
        }
        if (file.type === 'application/x-zip-compressed-fb2' || hasExtension(file, '.fb2.zip', '.fbz')) {
            const { makeFB2 } = await import('./fb2.js')
            const entry = loader.entries.find(entry => entry.filename.toLowerCase().endsWith('.fb2'))
                ?? loader.entries.find(entry => !entry.filename.endsWith('/'))
            const blob = entry ? await loader.loadBlob(entry.filename) : null
            if (!blob) throw new NotFoundError('No FictionBook document in archive')
            return makeFB2(blob)
        }
        const { EPUB } = await import('./epub.js')
        return new EPUB(loader).init()
    }
    if (await hasSignature(file, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
        const { makePDF } = await import('./pdf.js')
        return makePDF(file)
    }
    const { isMOBI, MOBI } = await import('./mobi.js')
    if (await isMOBI(file)) {
        const { unzlibSync } = await import('./vendor/fflate.js')
        return new MOBI({ unzlib: unzlibSync }).open(file)
    }
    if (file.type === 'application/x-fictionbook+xml' || hasExtension(file, '.fb2')) {
        const { makeFB2 } = await import('./fb2.js')
        return makeFB2(file)
    }
    throw new UnsupportedTypeError('File type not supported')
}
