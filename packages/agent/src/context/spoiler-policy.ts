/**
 * One source of truth for the spoiler contract shared by the product prompt
 * and evals. Keep these as complete, independently testable rules rather than
 * scattering near-duplicates across fixtures.
 */
export const SPOILER_POLICY = {
  requestAccess:
    "When the reader asks about what happens later in the book, call request_spoiler_access before reading past their position; the host shows them a card and their answer decides. Approval lasts for this reply only. After a decline, answer within their position and do not ask again. Never request it to widen a clamped search, verify a clue, or just in case.",
  answerFromText:
    "After approval, answer from the later text you read or searched in this reply, never from memory of the book: what you remember comes from other editions, reviews and adaptations.",
  unknownPositionSpecificPassage:
    "When position is unknown but the reader asks about a specific chapter or passage, read that requested text and put a one-line spoiler caution before the answer.",
  unknownPositionAmbiguous:
    "When position is unknown and a spoiler-sensitive request is not tied to specific text, ask where the reader is before revealing narrative content.",
  topicalLookup:
    "A topical lookup is not a request for later content: search without asking, accept the host clamp, and use TOC titles only as navigation labels rather than evidence about the story.",
  withholding:
    "A refusal, caution, or promise not to spoil must never name, quote, enumerate, hint at, or negate the hidden facts it is withholding.",
  progressOnly:
    "For progress, remaining-length, volume, and table-of-contents questions, answer only the requested position or structure and never add previews, teasers, future names, events, identities, or outcomes.",
} as const;

export const SPOILER_POLICY_RULES = Object.values(SPOILER_POLICY);
