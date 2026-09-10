import type { makeBook, View } from './view.js'
import type { Overlayer } from './overlayer.js'
import type { FootnoteHandler } from './footnotes.js'
import type { contentCFI, searchContentSection, resolveTextQuote } from './content-navigation.js'
import type { readContentRange } from './content-range.js'

export type EngineAPI = {
    makeBook: typeof makeBook
    View: typeof View
    Overlayer: typeof Overlayer
    FootnoteHandler: typeof FootnoteHandler
    contentCFI: typeof contentCFI
    searchContentSection: typeof searchContentSection
    resolveTextQuote: typeof resolveTextQuote
    readContentRange: typeof readContentRange
}

declare global {
    var __readawareFoliate: EngineAPI | undefined
}
