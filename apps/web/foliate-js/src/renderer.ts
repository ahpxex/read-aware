import type { Overlayer } from './overlayer.js'

export type RelocateReason = 'page' | 'snap' | 'scroll' | 'anchor' | 'navigation' | 'selection'
export type RelocateDetail = {
    reason: RelocateReason | null
    range: Range | null
    index: number
    fraction?: number
    size?: number
}
export type Content = { doc: Document; index: number; overlayer?: Overlayer }
export type LoadDetail = { doc: Document; index: number }
export type CreateOverlayerDetail = LoadDetail & { attach: (overlayer: Overlayer) => void }
