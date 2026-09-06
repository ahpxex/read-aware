/** Structural AppError contract without a runtime dependency on the app bundle. */
export class UnsupportedEncryptionError extends Error {
    code = 'book/unsupported-encryption';
    retryable = false;
    constructor(format, algorithm) {
        super(`Unsupported ${format} encryption${algorithm ? ': ' + algorithm : ''}`);
        this.name = 'UnsupportedEncryptionError';
    }
}
