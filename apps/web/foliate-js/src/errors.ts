/** Structural AppError contract without a runtime dependency on the app bundle. */
export class UnsupportedEncryptionError extends Error {
    readonly code = 'book/unsupported-encryption'
    readonly retryable = false
    constructor(format: string, algorithm?: string) {
        super(`Unsupported ${format} encryption${algorithm ? ': ' + algorithm : ''}`)
        this.name = 'UnsupportedEncryptionError'
    }
}
