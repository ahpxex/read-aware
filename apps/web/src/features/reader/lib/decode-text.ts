/**
 * Decode a plain-text book to a string.
 *
 * Text files carry no encoding declaration, and the ones people actually own
 * are not all UTF-8 — Chinese TXT books are routinely GB18030 or Big5, and
 * older Western ones are single-byte code pages. Guessing wrong does not fail
 * loudly; it produces a whole book of mojibake. So each candidate encoding is
 * tried in strict mode and the first one that decodes cleanly wins, with a
 * lossy Latin-1 pass as the last resort so a book always opens.
 */

/** Byte-order marks decide the encoding outright — no guessing needed. */
const BOMS: { bytes: number[]; encoding: string }[] = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bytes: [0xff, 0xfe], encoding: "utf-16le" },
  { bytes: [0xfe, 0xff], encoding: "utf-16be" },
];

/**
 * GB18030 covers GBK and GB2312 (it is a strict superset), so one candidate
 * serves every mainland-Chinese file. Big5 follows for traditional Chinese,
 * then Shift_JIS and EUC-KR. Strict decoding rejects the wrong ones: these
 * multi-byte schemes have illegal byte sequences that a mismatched file hits
 * almost immediately.
 */
const CANDIDATE_ENCODINGS = ["utf-8", "gb18030", "big5", "shift_jis", "euc-kr"];

export function decodeTextBook(bytes: Uint8Array): string {
  for (const { bytes: bom, encoding } of BOMS) {
    if (bom.every((byte, index) => bytes[index] === byte)) {
      return stripBom(decodeOrNull(bytes, encoding) ?? decodeLossy(bytes));
    }
  }

  for (const encoding of CANDIDATE_ENCODINGS) {
    const decoded = decodeOrNull(bytes, encoding);
    if (decoded != null && !looksLikeMojibake(decoded)) return decoded;
  }

  return decodeLossy(bytes);
}

function decodeOrNull(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeLossy(bytes: Uint8Array): string {
  return new TextDecoder("windows-1252").decode(bytes);
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/**
 * A legacy CJK file can decode "successfully" as another CJK encoding while
 * producing nothing but rare ideographs and private-use characters. Real prose
 * in any language keeps a substantial share of ASCII (spaces, digits,
 * punctuation) or of common CJK; a page of replacement/private-use characters
 * means the candidate was wrong.
 */
function looksLikeMojibake(value: string): boolean {
  const sample = value.slice(0, 4096);
  if (!sample) return false;
  let suspicious = 0;
  for (const char of sample) {
    const code = char.codePointAt(0)!;
    if (
      code === 0xfffd ||
      (code >= 0xe000 && code <= 0xf8ff) ||
      (code >= 0x0080 && code <= 0x00a0)
    ) {
      suspicious++;
    }
  }
  return suspicious > sample.length * 0.02;
}
