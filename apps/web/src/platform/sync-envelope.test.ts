import { describe, expect, test } from "bun:test";
import {
  DEFAULT_KDF_PARAMS,
  deriveMasterKey,
  fromBase64,
  makeKeyCheck,
  newKdfSalt,
  openBlob,
  openEvent,
  sealBlob,
  sealEvent,
  toBase64,
  verifyKeyCheck,
  type PlainEvent,
} from "./sync-envelope";

/** Fast KDF for tests only — production uses DEFAULT_KDF_PARAMS. */
const TEST_KDF = { algo: "argon2id", t: 1, m: 16, p: 1 } as const;

const key = deriveMasterKey("正确的 passphrase", "c2FsdHNhbHRzYWx0c2FsdA==", TEST_KDF);

function event(overrides: Partial<PlainEvent> = {}): PlainEvent {
  return {
    id: "evt-1",
    type: "highlight.created",
    hlc: { wallMs: 1_700_000_000_000, counter: 3, deviceId: "device-a" },
    aggregateType: "highlight",
    aggregateId: "h1",
    origin: "user",
    createdAt: "2026-08-13T00:00:00.000Z",
    payload: { highlightId: "h1", bookId: "b1", text: "恐惧是思维杀手" },
    ...overrides,
  };
}

describe("event envelope", () => {
  test("round trips the full event, CJK payload included", () => {
    const sealed = sealEvent(key, event());
    expect(openEvent(key, sealed)).toEqual(event());
  });

  test("the clear part reveals nothing that describes behavior", () => {
    const sealed = sealEvent(key, event());
    const clear = JSON.stringify(sealed);
    // Only id + hlc + nonce + ciphertext cross in the clear.
    expect(Object.keys(sealed).sort()).toEqual(["ciphertext", "hlc", "id", "nonce", "v"]);
    expect(clear).not.toContain("highlight");
    expect(clear).not.toContain("bookId");
  });

  test("sealing the same event twice never reuses a nonce or ciphertext", () => {
    const a = sealEvent(key, event());
    const b = sealEvent(key, event());
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    // Both still open.
    expect(openEvent(key, a)).toEqual(openEvent(key, b));
  });

  test("a flipped ciphertext byte fails loudly, not garbled", () => {
    const sealed = sealEvent(key, event());
    const bytes = fromBase64(sealed.ciphertext);
    bytes[0] ^= 0x01;
    expect(() => openEvent(key, { ...sealed, ciphertext: toBase64(bytes) })).toThrow();
  });

  test("ciphertext grafted onto another event's identity is rejected (AAD)", () => {
    const sealed = sealEvent(key, event());
    // A malicious relay replays the ciphertext under a different id...
    expect(() => openEvent(key, { ...sealed, id: "evt-2" })).toThrow();
    // ...or under a different position in the log.
    expect(() =>
      openEvent(key, { ...sealed, hlc: { ...sealed.hlc, wallMs: sealed.hlc.wallMs + 1 } }),
    ).toThrow();
  });

  test("the wrong key opens nothing", () => {
    const other = deriveMasterKey("另一个 passphrase", "c2FsdHNhbHRzYWx0c2FsdA==", TEST_KDF);
    expect(() => openEvent(other, sealEvent(key, event()))).toThrow();
  });

  test("an unknown envelope version is refused before any crypto runs", () => {
    const sealed = sealEvent(key, event());
    expect(() => openEvent(key, { ...sealed, v: 2 as unknown as 1 })).toThrow(/version/);
  });
});

describe("blob envelope", () => {
  const bytes = new TextEncoder().encode("PK\x03\x04 fake epub bytes 中文内容");

  test("round trips bytes under the blob's key identity", () => {
    const wire = sealBlob(key, "bookfile:b1", bytes);
    expect(openBlob(key, "bookfile:b1", wire)).toEqual(bytes);
    // Sealed form shares no bytes with the plaintext beyond chance.
    expect(wire.length).toBeGreaterThan(bytes.length);
  });

  test("ciphertext served back under a different blob key is rejected", () => {
    const wire = sealBlob(key, "bookfile:b1", bytes);
    expect(() => openBlob(key, "bookfile:b2", wire)).toThrow();
  });

  test("tampered bytes are rejected", () => {
    const wire = sealBlob(key, "bookfile:b1", bytes);
    wire[wire.length - 1] ^= 0x01;
    expect(() => openBlob(key, "bookfile:b1", wire)).toThrow();
  });

  test("an unrecognized version byte is refused", () => {
    const wire = sealBlob(key, "bookfile:b1", bytes);
    wire[0] = 9;
    expect(() => openBlob(key, "bookfile:b1", wire)).toThrow(/unrecognized/);
  });
});

describe("passphrase derivation", () => {
  test("same passphrase + salt + params ⇒ same key on every device", () => {
    const salt = newKdfSalt();
    const a = deriveMasterKey("鲸鱼在唱歌", salt, TEST_KDF);
    const b = deriveMasterKey("鲸鱼在唱歌", salt, TEST_KDF);
    expect(toBase64(a)).toBe(toBase64(b));
    expect(a.length).toBe(32);
  });

  test("salt and passphrase both change the key", () => {
    const salt = newKdfSalt();
    const base = deriveMasterKey("鲸鱼在唱歌", salt, TEST_KDF);
    expect(toBase64(deriveMasterKey("鲸鱼在唱歌", newKdfSalt(), TEST_KDF))).not.toBe(toBase64(base));
    expect(toBase64(deriveMasterKey("鲸鱼在唱歌。", salt, TEST_KDF))).not.toBe(toBase64(base));
  });

  test("NFKC normalization: composed and decomposed input derive the same key", () => {
    const salt = newKdfSalt();
    const composed = "café";
    const decomposed = "café";
    expect(composed).not.toBe(decomposed);
    expect(toBase64(deriveMasterKey(composed, salt, TEST_KDF))).toBe(
      toBase64(deriveMasterKey(decomposed, salt, TEST_KDF)),
    );
  });

  test("production defaults are the OWASP argon2id profile", () => {
    expect(DEFAULT_KDF_PARAMS).toEqual({ algo: "argon2id", t: 2, m: 19_456, p: 1 });
  });
});

describe("key check", () => {
  test("verifies the right key and rejects a wrong one without throwing", () => {
    const check = makeKeyCheck(key);
    expect(verifyKeyCheck(key, check)).toBe(true);
    const wrong = deriveMasterKey("打错了", "c2FsdHNhbHRzYWx0c2FsdA==", TEST_KDF);
    expect(verifyKeyCheck(wrong, check)).toBe(false);
    expect(verifyKeyCheck(key, "v1:not-base64!!!")).toBe(false);
    expect(verifyKeyCheck(key, "v9:whatever")).toBe(false);
  });

  test("two checks for the same key differ (fresh nonce) but both verify", () => {
    const a = makeKeyCheck(key);
    const b = makeKeyCheck(key);
    expect(a).not.toBe(b);
    expect(verifyKeyCheck(key, a)).toBe(true);
    expect(verifyKeyCheck(key, b)).toBe(true);
  });
});
