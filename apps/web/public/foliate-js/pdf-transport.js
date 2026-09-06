import { PDFDataRangeTransport } from './vendor/pdfjs/pdf.mjs';
/** Implements PDF.js's range transport extension point without replacing methods on an instance. */
export class BookRangeTransport extends PDFDataRangeTransport {
    file;
    onError;
    #aborted = false;
    constructor(file, onError) {
        super(file.size, new Uint8Array());
        this.file = file;
        this.onError = onError;
    }
    requestDataRange(begin, end) {
        if (this.#aborted)
            return;
        void Promise.resolve().then(() => this.file.slice(begin, end).arrayBuffer()).then(chunk => {
            if (this.#aborted)
                return;
            if (chunk.byteLength !== end - begin)
                throw new Error('Incomplete PDF byte range');
            this.onDataRange(begin, new Uint8Array(chunk));
        }).catch(error => {
            if (!this.#aborted) {
                this.#aborted = true;
                this.onError(error);
            }
        });
    }
    abort() {
        this.#aborted = true;
    }
}
