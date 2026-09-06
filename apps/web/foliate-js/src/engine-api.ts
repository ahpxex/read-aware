import type { makeBook, View } from './view.js'
import type { Overlayer } from './overlayer.js'
import type { FootnoteHandler } from './footnotes.js'

export type EngineAPI = {
    makeBook: typeof makeBook
    View: typeof View
    Overlayer: typeof Overlayer
    FootnoteHandler: typeof FootnoteHandler
}

declare global {
    var __readawareFoliate: EngineAPI | undefined
}
