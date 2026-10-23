import { describe, expect, test } from "bun:test";
import {
  abortSignalAny,
  arrayToReversed,
  arrayToSorted,
  arrayToSpliced,
  arrayWith,
  installEcmaScriptPolyfills,
  mapGroupBy,
  objectGroupBy,
  promiseWithResolvers,
  stringIsWellFormed,
  stringToWellFormed,
  type PolyfillGlobals,
} from "./polyfills";

/** A realm that predates every ES2023/ES2024 built-in the app relies on. */
function bareGlobals(): PolyfillGlobals {
  class BarePromise<T> extends Promise<T> {}
  // oxlint-disable-next-line typescript/no-floating-promises -- defineProperty returns the constructor, not a promise
  Object.defineProperty(BarePromise, "withResolvers", { value: undefined, configurable: true });
  const arrayPrototype = Object.create(Array.prototype, {
    toSorted: { value: undefined, configurable: true },
    toReversed: { value: undefined, configurable: true },
    toSpliced: { value: undefined, configurable: true },
    with: { value: undefined, configurable: true },
    [Symbol.unscopables]: { value: {}, configurable: true },
  }) as Record<PropertyKey, unknown>;
  return {
    Promise: BarePromise as unknown as Record<PropertyKey, unknown>,
    Object: {},
    Map: {},
    Array: { prototype: arrayPrototype },
    String: { prototype: {} },
    AbortSignal: {},
  };
}

describe("Promise.withResolvers", () => {
  test("resolves and rejects through the returned handles", async () => {
    const settled = promiseWithResolvers.call(Promise) as PromiseWithResolvers<number>;
    settled.resolve(7);
    await expect(settled.promise).resolves.toBe(7);
    const failed = promiseWithResolvers.call(Promise) as PromiseWithResolvers<unknown>;
    failed.reject(new Error("no"));
    await expect(failed.promise).rejects.toThrow("no");
  });

  test("constructs through the receiver so subclasses get their own instances", () => {
    class Tracked<T> extends Promise<T> {}
    const { promise } = promiseWithResolvers.call(Tracked) as PromiseWithResolvers<void>;
    expect(promise).toBeInstanceOf(Tracked);
  });
});

describe("Object.groupBy", () => {
  test("groups by the callback's key with a null-prototype result", () => {
    const groups = objectGroupBy([1, 2, 3, 4], (n) => (n % 2 ? "odd" : "even"));
    expect(Object.getPrototypeOf(groups)).toBeNull();
    expect(groups).toEqual({ odd: [1, 3], even: [2, 4] });
  });

  test("coerces keys to property keys, keeps symbols and passes the index", () => {
    const sym = Symbol("s");
    const seen: number[] = [];
    const groups = objectGroupBy(["a", "b", "c"], (_item, index) => {
      seen.push(index);
      return index === 2 ? sym : index;
    });
    expect(seen).toEqual([0, 1, 2]);
    const record = groups as Record<PropertyKey, string[]>;
    expect(record[0]).toEqual(["a"]);
    expect(record["1"]).toEqual(["b"]);
    expect(record[sym]).toEqual(["c"]);
    const proto = objectGroupBy(["x"], () => "__proto__") as Record<string, string[]>;
    expect(proto["__proto__"]).toEqual(["x"]);
  });

  test("rejects a missing iterable or a non-callable", () => {
    expect(() => objectGroupBy(null as never, () => "k")).toThrow(TypeError);
    expect(() => objectGroupBy([1], "nope" as never)).toThrow(TypeError);
  });
});

describe("Map.groupBy", () => {
  test("keeps key identity and folds -0 into +0", () => {
    const a = {},
      b = {};
    const byObject = mapGroupBy([1, 2, 3], (n) => (n < 3 ? a : b));
    expect(byObject.get(a)).toEqual([1, 2]);
    expect(byObject.get(b)).toEqual([3]);
    const byZero = mapGroupBy([-1, 1], (n) => (n < 0 ? -0 : 0));
    expect(byZero.size).toBe(1);
    expect(Object.is([...byZero.keys()][0], 0)).toBe(true);
    expect(byZero.get(0)).toEqual([-1, 1]);
  });
});

describe("change Array by copy", () => {
  test("toSorted sorts a copy, reads holes as undefined and validates the comparator first", () => {
    // oxlint-disable-next-line no-sparse-arrays -- the hole is the behavior under test
    const source: (number | undefined)[] = [3, , 1];
    const sorted = arrayToSorted.call(source) as (number | undefined)[];
    expect(sorted).toEqual([1, 3, undefined]);
    // oxlint-disable-next-line no-sparse-arrays -- the source must keep its hole
    expect(source).toEqual([3, , 1]);
    expect(2 in source).toBe(true);
    expect(arrayToSorted.call([3, 1, 2], (a, b) => (b as number) - (a as number))).toEqual([3, 2, 1]);
    expect(() => arrayToSorted.call(null, undefined)).toThrow(TypeError);
    expect(() => arrayToSorted.call([1], "bad" as never)).toThrow(TypeError);
  });

  test("toSorted and toReversed accept array-likes", () => {
    const like = { length: 3, 0: "c", 1: "a", 2: "b" };
    expect(arrayToSorted.call(like)).toEqual(["a", "b", "c"]);
    expect(arrayToReversed.call(like)).toEqual(["b", "a", "c"]);
    expect(arrayToReversed.call("ab")).toEqual(["b", "a"]);
  });

  test("toSpliced distinguishes arity, clamps and inserts", () => {
    const source = [0, 1, 2, 3];
    expect(arrayToSpliced.call(source)).toEqual([0, 1, 2, 3]);
    expect(arrayToSpliced.call(source, 2)).toEqual([0, 1]);
    expect(arrayToSpliced.call(source, 2, undefined)).toEqual([0, 1, 2, 3]);
    expect(arrayToSpliced.call(source, 1, 2, "a", "b")).toEqual([0, "a", "b", 3]);
    expect(arrayToSpliced.call(source, -1, 5)).toEqual([0, 1, 2]);
    expect(arrayToSpliced.call(source, 10, 1, "x")).toEqual([0, 1, 2, 3, "x"]);
    expect(arrayToSpliced.call(source, 0, -4)).toEqual([0, 1, 2, 3]);
    expect(source).toEqual([0, 1, 2, 3]);
  });

  test("with replaces one index on a copy and rejects out-of-range indices", () => {
    const source = [1, 2, 3];
    expect(arrayWith.call(source, 1, 9)).toEqual([1, 9, 3]);
    expect(arrayWith.call(source, -1, 9)).toEqual([1, 2, 9]);
    expect(arrayWith.call(source, 1.9, 9)).toEqual([1, 9, 3]);
    expect(source).toEqual([1, 2, 3]);
    expect(() => arrayWith.call(source, 3, 0)).toThrow(RangeError);
    expect(() => arrayWith.call(source, -4, 0)).toThrow(RangeError);
  });
});

describe("well-formed strings", () => {
  test("only lone surrogates are malformed", () => {
    expect(stringIsWellFormed.call("plain 😀 text")).toBe(true);
    expect(stringIsWellFormed.call("lone \uD83D here")).toBe(false);
    expect(stringIsWellFormed.call("lone \uDE00 here")).toBe(false);
    expect(stringToWellFormed.call("a\uD83Db\uDE00c😀")).toBe("a�b�c😀");
    expect(stringToWellFormed.call(42)).toBe("42");
    expect(() => stringIsWellFormed.call(undefined)).toThrow(TypeError);
  });
});

describe("AbortSignal.any", () => {
  const listenerCount = (controller: AbortController) => {
    let count = 0;
    const signal = controller.signal;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((type: string, ...rest: never[]) => {
      if (type === "abort") count += 1;
      return add(type, ...(rest as [never, never]));
    }) as typeof signal.addEventListener;
    signal.removeEventListener = ((type: string, ...rest: never[]) => {
      if (type === "abort") count -= 1;
      return remove(type, ...(rest as [never, never]));
    }) as typeof signal.removeEventListener;
    return () => count;
  };

  test("an already-aborted input aborts the result, first in iteration order", () => {
    const reason = new Error("gone");
    const combined = abortSignalAny.call(AbortSignal, [AbortSignal.abort(reason), AbortSignal.abort("later")]);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe(reason);
    const pending = new AbortController();
    expect(abortSignalAny.call(AbortSignal, [pending.signal, AbortSignal.abort("early")]).reason).toBe("early");
    expect(pending.signal.aborted).toBe(false);
  });

  test("the first source to abort aborts the dependent signal with its reason", () => {
    const one = new AbortController();
    const two = new AbortController();
    const combined = abortSignalAny.call(AbortSignal, [one.signal, two.signal]);
    expect(combined.aborted).toBe(false);
    const reason = new Error("two fired");
    two.abort(reason);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe(reason);
    one.abort("late");
    expect(combined.reason).toBe(reason);
  });

  test("an abort removes the dependent's listeners from every source", () => {
    const one = new AbortController();
    const two = new AbortController();
    const oneCount = listenerCount(one);
    const twoCount = listenerCount(two);
    const combined = abortSignalAny.call(AbortSignal, [one.signal, two.signal]);
    expect(oneCount()).toBe(1);
    expect(twoCount()).toBe(1);
    two.abort();
    expect(combined.aborted).toBe(true);
    expect(oneCount()).toBe(0);
    expect(twoCount()).toBe(0);
  });

  test("an empty iterable produces a signal that never aborts", () => {
    const combined = abortSignalAny.call(AbortSignal, []);
    expect(combined.aborted).toBe(false);
    expect(combined.reason).toBeUndefined();
  });
});

describe("installEcmaScriptPolyfills", () => {
  test("fills every missing built-in as a non-enumerable method and reports it", () => {
    const globals = bareGlobals();
    const installed = installEcmaScriptPolyfills(globals);
    expect(installed).toEqual([
      "Promise.withResolvers",
      "Object.groupBy",
      "Map.groupBy",
      "Array.prototype.toSorted",
      "Array.prototype.toReversed",
      "Array.prototype.toSpliced",
      "Array.prototype.with",
      "String.prototype.isWellFormed",
      "String.prototype.toWellFormed",
      "AbortSignal.any",
    ]);
    expect(typeof globals.Promise.withResolvers).toBe("function");
    expect(Object.getOwnPropertyDescriptor(globals.Array.prototype, "toSorted")).toMatchObject({
      enumerable: false,
      writable: true,
      configurable: true,
    });
    expect(globals.Array.prototype[Symbol.unscopables]).toMatchObject({
      toSorted: true,
      toReversed: true,
      toSpliced: true,
      with: true,
    });
    // The filled `Promise.withResolvers` uses its receiver, like the native.
    const { promise } = (globals.Promise.withResolvers as typeof promiseWithResolvers).call(
      globals.Promise as unknown as PromiseConstructor,
    );
    expect(promise).toBeInstanceOf(globals.Promise as unknown as PromiseConstructor);
  });

  test("installs AbortSignal.any only where the constructor lacks it", () => {
    const globals = bareGlobals();
    installEcmaScriptPolyfills(globals);
    expect(globals.AbortSignal?.any).toBe(abortSignalAny);
    const withNative = { ...bareGlobals(), AbortSignal: { any: () => "native" } };
    expect(installEcmaScriptPolyfills(withNative)).not.toContain("AbortSignal.any");
    expect(withNative.AbortSignal.any()).toBe("native");
  });

  test("never replaces a native and installs nothing twice", () => {
    const globals = bareGlobals();
    installEcmaScriptPolyfills(globals);
    const first = globals.Object.groupBy;
    expect(installEcmaScriptPolyfills(globals)).toEqual([]);
    expect(globals.Object.groupBy).toBe(first);
    // Bun's realm already ships everything: importing the module changed nothing.
    expect(installEcmaScriptPolyfills(globalThis as unknown as PolyfillGlobals)).toEqual([]);
    expect(Promise.withResolvers).not.toBe(promiseWithResolvers);
  });
});
