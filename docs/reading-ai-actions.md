# Reading AI Actions

The four feature preferences govern host-owned explain, define, translate and
chapter-summary actions. They are independent of the general conversation toggle.
All surfaces use the same execution gate; hiding controls alone is insufficient.

Selection actions capture the active reader session and exact selection. A bounded
preview is not a complete selection: the host reads its versioned range, or rejects
unsupported/oversized input instead of silently explaining a prefix. Chapter
summary captures the extracted chapter index corresponding to the current source
href. The instruction asks the existing book Agent to read that chapter with its
normal tools, not to summarize only the viewport. Neither path creates a second
Agent or writes synthetic assistant messages.

Native clicks and palette commands open the book chat and wait for its existing
send handler to accept the prepared turn. Loading can wait; busy chat, cancellation,
retired reader, changed source/selection or disabled preference cannot start a late
turn. After acceptance the receipt says started, not completed inference. Normal
chat error/retry/stop semantics own the remainder. No new unbounded request queue.

An Agent already answering in this book receives the captured instruction and
context as its tool result, then answers in that same turn. It does not schedule a
recursive new turn into itself. A global Agent opens the active book chat and starts
the same host-owned action. Tools are rebuilt from enabled preferences before each
model request, and execution rechecks the gate. Book threads cannot act on a different
active book. These are explicit reading actions, not permission to reconstruct text
withheld by sendHighlightedText/sendSurroundingContext or to bypass localOnly.

Stage one verifies pure behavior, actual adapters, cancellation/permissions and
types only. Real Tauri interaction, source format coverage and model response quality
remain stage-three acceptance; no fixture constitutes those results.
