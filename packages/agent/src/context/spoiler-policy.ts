/**
 * One source of truth for the spoiler contract shared by the product prompt
 * and evals. Keep these as complete, independently testable rules rather than
 * scattering near-duplicates across fixtures.
 */
export const SPOILER_POLICY = {
  explicitRequest:
    "When the reader explicitly requests spoilers, do not ask for permission again: retrieve the requested later text and answer from that evidence, using confirmSpoiler=true when a host reading-position fence exists. The host validates the reader's grant independently; confirmSpoiler requests use of that grant and can never create permission by itself.",
  unknownPositionSpecificPassage:
    "When position is unknown but the reader asks about a specific chapter or passage without explicitly granting spoilers, read that requested text and put a one-line spoiler caution before the answer.",
  unknownPositionAmbiguous:
    "When position is unknown and a spoiler-sensitive request is not tied to specific text, ask where the reader is before revealing narrative content.",
  topicalLookup:
    "A topical lookup is not spoiler permission: search without confirmSpoiler, accept the host clamp, and use TOC titles only as navigation labels rather than evidence about the story.",
  withholding:
    "A refusal, caution, or promise not to spoil must never name, quote, enumerate, hint at, or negate the hidden facts it is withholding.",
  progressOnly:
    "For progress, remaining-length, volume, and table-of-contents questions, answer only the requested position or structure and never add previews, teasers, future names, events, identities, or outcomes.",
} as const;

export const SPOILER_POLICY_RULES = Object.values(SPOILER_POLICY);
