import type { UserInteractionAnswer, UserInteractionOption } from "../ports";

const SPOILER_TERM = /(?:剧透|泄底|爆雷|spoilers?|spoil(?:ed|ing)?)/iu;
const EXPLICIT_GRANT = [
  /(?:可以|允许|同意|接受|不怕|不介意|无所谓|随便|尽管|直接|放心|别管|不要管|不用管).{0,10}(?:剧透|泄底|爆雷)/u,
  /(?:剧透|泄底|爆雷).{0,10}(?:可以|没关系|没事|无所谓|随意|也行|不怕|不介意|同意|接受)/u,
  /(?:you\s+can|please|go\s+ahead\s+and|feel\s+free\s+to).{0,18}spoil/iu,
  /(?:spoilers?|spoil(?:ing)?).{0,18}(?:are\s+)?(?:ok(?:ay)?|fine|allowed|welcome)/iu,
  /(?:i\s+(?:do\s+not|don't)\s+mind|full).{0,12}spoilers?/iu,
] as const;
const EXPLICIT_DENIAL =
  /(?:不可以|不要|拒绝|不接受|不想|不能).{0,8}(?:剧透|泄底|爆雷)|别(?:再|给我|跟我)?(?:剧透|泄底|爆雷)|(?:no|decline|without|avoid).{0,12}spoilers?|(?:do\s+not|don't).{0,8}(?:spoil|reveal)/iu;
const AFFIRMATIVE =
  /^(?:可以|允许|同意|接受|没关系|没事|不怕|不介意|直接讲|直接说|继续|好的?|行|是|yes|yep|yeah|approve|allow|allowed|okay|ok|fine|go ahead|tell me|full)$/iu;

/**
 * Host-owned authorization check. A model tool argument is a request to use
 * permission, never proof that the reader granted it.
 */
export function hasExplicitSpoilerPermission(text: string): boolean {
  const normalized = text.normalize("NFKC").trim();
  if (!normalized || EXPLICIT_DENIAL.test(normalized)) return false;
  return EXPLICIT_GRANT.some((pattern) => pattern.test(normalized));
}

/** A positive answer to an explicit spoiler-permission question also grants it. */
export function interactionGrantsSpoilerPermission(input: {
  question: string;
  options: UserInteractionOption[];
  answer: UserInteractionAnswer;
}): boolean {
  if (input.answer.cancelled) return false;
  const selected = input.options.find((option) => option.id === input.answer.optionId);
  const responseParts = [
    input.answer.text,
    selected?.label,
    selected?.description,
    input.answer.optionId,
  ]
    .filter((value): value is string => !!value?.trim())
    .map((value) => value.normalize("NFKC").trim());
  if (!responseParts.length || responseParts.some((value) => EXPLICIT_DENIAL.test(value))) {
    return false;
  }
  if (responseParts.some(hasExplicitSpoilerPermission)) return true;
  return SPOILER_TERM.test(input.question) && responseParts.some((value) => AFFIRMATIVE.test(value));
}
