import type { BookFile } from './book.js'
import { PDFDataRangeTransport } from './vendor/pdfjs/pdf.mjs'

/** Implements PDF.js's range transport extension point without replacing methods on an instance. */
export class BookRangeTransport extends PDFDataRangeTransport {
    #aborted = false
    constructor(private readonly file: BookFile, private readonly onError: (error: unknown) => void) {
        super(file.size, new Uint8Array())
    }
    override requestDataRange(begin: number, end: number): void {
        if (this.#aborted) return
        void Promise.resolve().then(() => this.file.slice(begin, end).arrayBuffer()).then(chunk => {
            if (this.#aborted) return
            if (chunk.byteLength !== end - begin) throw new Error('Incomplete PDF byte range')
            this.onDataRange(begin, new Uint8Array(chunk))
        }).catch((error: unknown) => {
            if (!this.#aborted) { this.#aborted = true; this.onError(error) }
        })
    }
    override abort(): void {
        this.#aborted = true
    }
}
