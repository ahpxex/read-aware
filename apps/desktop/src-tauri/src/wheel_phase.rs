//! AppKit input edges are document-scoped input, not persistent domain events.
//! The native monitor lives with the app; readers only own DOM listeners.

use tauri::Manager;

const PHASE_BEGAN: u64 = 1 << 0;
const PHASE_ENDED: u64 = 1 << 3;
const PHASE_CANCELLED: u64 = 1 << 4;
const PHASE_MAY_BEGIN: u64 = 1 << 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Edge {
    Touch,
    Momentum,
    End,
}

fn classify(phase: u64, momentum: u64) -> Option<Edge> {
    if phase & (PHASE_MAY_BEGIN | PHASE_BEGAN) != 0 {
        Some(Edge::Touch)
    } else if momentum & PHASE_BEGAN != 0 {
        Some(Edge::Momentum)
    } else if momentum & (PHASE_ENDED | PHASE_CANCELLED) != 0 {
        Some(Edge::End)
    } else {
        None
    }
}

impl Edge {
    // Closed static scripts: no paths, book text or external strings enter eval.
    fn script(self) -> &'static str {
        match self {
            Self::Touch => {
                "window.dispatchEvent(new CustomEvent('ra-wheel-phase', { detail: 'touch' }));"
            }
            Self::Momentum => {
                "window.dispatchEvent(new CustomEvent('ra-wheel-phase', { detail: 'momentum' }));"
            }
            Self::End => {
                "window.dispatchEvent(new CustomEvent('ra-wheel-phase', { detail: 'end' }));"
            }
        }
    }
}

pub fn install(app: tauri::AppHandle) {
    use block::ConcreteBlock;
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};

    const SCROLL_WHEEL_MASK: u64 = 1 << 22;
    let handler = ConcreteBlock::new(move |event: id| -> id {
        let phase: u64 = unsafe { msg_send![event, phase] };
        let momentum: u64 = unsafe { msg_send![event, momentumPhase] };
        if let Some(edge) = classify(phase, momentum) {
            // No window during teardown is normal; there is no input consumer.
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.eval(edge.script()) {
                    log::warn!("Wheel phase delivery failed: {error}");
                }
            }
        }
        event
    })
    .copy();
    let monitor: id = unsafe {
        msg_send![
            class!(NSEvent),
            addLocalMonitorForEventsMatchingMask: SCROLL_WHEEL_MASK
            handler: &*handler
        ]
    };
    // AppKit's autoreleased monitor and block must survive until app exit.
    let _: id = unsafe { msg_send![monitor, retain] };
    std::mem::forget(handler);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingers_take_precedence_over_old_momentum() {
        for phase in [PHASE_BEGAN, PHASE_MAY_BEGIN, PHASE_BEGAN | PHASE_MAY_BEGIN] {
            assert_eq!(
                classify(phase, PHASE_BEGAN | PHASE_ENDED),
                Some(Edge::Touch)
            );
        }
    }

    #[test]
    fn drag_end_is_not_the_end_of_momentum() {
        assert_eq!(classify(PHASE_ENDED, 0), None);
        assert_eq!(classify(PHASE_CANCELLED, 0), None);
        assert_eq!(classify(0, PHASE_BEGAN), Some(Edge::Momentum));
        assert_eq!(classify(0, PHASE_ENDED), Some(Edge::End));
        assert_eq!(classify(0, PHASE_CANCELLED), Some(Edge::End));
        assert_eq!(classify(0, 0), None);
        assert_eq!(classify(1 << 2, 1 << 2), None);
    }

    #[test]
    fn delivery_scripts_are_closed_and_use_the_document_event_contract() {
        for (edge, payload) in [
            (Edge::Touch, "touch"),
            (Edge::Momentum, "momentum"),
            (Edge::End, "end"),
        ] {
            assert_eq!(edge.script(), format!("window.dispatchEvent(new CustomEvent('ra-wheel-phase', {{ detail: '{payload}' }}));"));
        }
    }
}
