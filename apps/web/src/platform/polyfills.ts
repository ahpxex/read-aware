/**
 * ECMAScript built-ins and Web APIs the app may call that its oldest supported
 * engines lack.
 *
 * The compile floor is Vite's default target (Chrome/Edge 107, Firefox 104,
 * Safari 16), which decides which *syntax* gets lowered; runtime APIs are never
 * lowered. `tsconfig.json` meanwhile offers `lib: ES2024`, so source — ours and
 * every dependency's — can freely reach ES2023/ES2024 built-ins that only
 * arrived in Chrome 110–119 and Safari 16.4–17.4. Older WebViews on Android
 * e-readers sit exactly in that gap, and an un-updated macOS Safari 16 does
 * too. Issue #30 was the first casualty: the boot sequence died in
 * `DomainWriteGate.track` on `Promise.withResolvers` before React mounted.
 *
 * A vendored dependency can also use these (libarchive.js does), so replacing
 * calls in our own code — the approach #25 took for `Object.groupBy` — cannot
 * close the gap. Filling the missing built-ins once, before anything else
 * evaluates, does. Each entry installs only when the native is absent; a
 * native implementation is never replaced. This module must therefore be the
 * FIRST import of every entry point: `main.tsx` and the plugin sandbox worker
 * (its own realm). Workers with their own polyfills (pdf.js's legacy worker
 * build) need nothing.
 *
 * The same gap exists for Web APIs, not just ECMAScript built-ins:
 * `AbortSignal.any` (Safari 17.4, Chrome 116) is called across the app and by
 * plugins, and issue #41 is its iOS 16.0–16.3 casualty. It is filled here too
 * — with the spec's weak-source semantics, so `any` over app-lifetime signals
 * does not leak listeners.
 *
 * Deliberately not covered: ES2024 resizable `ArrayBuffer` and
 * `ArrayBuffer.prototype.transfer` (not shimmable without wrapping every typed
 * array), and anything past ES2024 — `lib: ES2024` keeps `tsc` from admitting
 * it in the first place.
 */

// ----- Abstract operations (ECMA-262 §7) -----

function toObject(value: unknown, method: string): Record<PropertyKey, unknown> & { length?: unknown } {
  if (value === null || value === undefined) {
    throw new TypeError(`${method} called on null or undefined`);
  }
  return Object(value) as Record<PropertyKey, unknown>;
}

function toIntegerOrInfinity(value: unknown): number {
  const number = Number(value);
  if (Number.isNaN(number)) return 0;
  // `|| 0` folds -0 into +0, as the spec's "if integer is -0, return +0".
  return Math.trunc(number) || 0;
}

const MAX_SAFE_LENGTH = Number.MAX_SAFE_INTEGER;

function toLength(value: unknown): number {
  const integer = toIntegerOrInfinity(value);
  return integer <= 0 ? 0 : Math.min(integer, MAX_SAFE_LENGTH);
}

function requireCallable(value: unknown, what: string): (...args: unknown[]) => unknown {
  if (typeof value !== "function") throw new TypeError(`${what} is not a function`);
  return value as (...args: unknown[]) => unknown;
}

/** Copy an array-like's indexed members. Holes read as `undefined`, as every
 * ES2023 change-array-by-copy method specifies. `ArrayCreate` limits still
 * apply: a length beyond 2^32 - 1 throws the engine's own RangeError. */
function copyIndexed(
  value: unknown,
  method: string,
): { source: Record<PropertyKey, unknown>; copy: unknown[]; length: number } {
  const source = toObject(value, method);
  const length = toLength(source.length);
  const copy = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) copy[index] = source[index];
  return { source, copy, length };
}

// ----- ES2024: Promise.withResolvers -----

export function promiseWithResolvers<T>(this: PromiseConstructor): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  // NewPromiseCapability(C): the receiver is the constructor, so subclasses
  // get instances of themselves, exactly like the native.
  const promise = new this<T>((fulfil, fail) => {
    resolve = fulfil;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// ----- ES2024: Object.groupBy / Map.groupBy -----

export function objectGroupBy<T, K extends PropertyKey>(
  items: Iterable<T>,
  keyOf: (item: T, index: number) => K,
): Partial<Record<K, T[]>> {
  toObject(items, "Object.groupBy");
  const callback = requireCallable(keyOf, "Object.groupBy callback");
  // Spec: the result has a null prototype, so a group named "constructor" or
  // "__proto__" is an ordinary own property.
  const groups = Object.create(null) as Record<PropertyKey, T[]>;
  let index = 0;
  for (const item of items) {
    // Bracket access performs ToPropertyKey: objects stringify, symbols stay.
    const key = callback(item, index) as PropertyKey;
    index += 1;
    (groups[key] ??= []).push(item);
  }
  return groups;
}

export function mapGroupBy<T, K>(items: Iterable<T>, keyOf: (item: T, index: number) => K): Map<K, T[]> {
  toObject(items, "Map.groupBy");
  const callback = requireCallable(keyOf, "Map.groupBy callback");
  const groups = new Map<K, T[]>();
  let index = 0;
  for (const item of items) {
    // `Map.prototype.set` already normalises -0 to +0, matching the spec step.
    const key = callback(item, index) as K;
    index += 1;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

// ----- ES2023: change Array by copy -----

export function arrayToSorted<T>(this: unknown, compare?: (a: T, b: T) => number): T[] {
  // The comparator is validated before the receiver is touched (spec order).
  if (compare !== undefined) requireCallable(compare, "The comparison function");
  const { copy } = copyIndexed(this, "Array.prototype.toSorted");
  return (copy as T[]).sort(compare);
}

export function arrayToReversed<T>(this: unknown): T[] {
  const { source, copy, length } = copyIndexed(this, "Array.prototype.toReversed");
  for (let index = 0; index < length; index += 1) copy[index] = source[length - 1 - index];
  return copy as T[];
}

export function arrayToSpliced<T>(this: unknown, ...args: [start?: number, skipCount?: number, ...items: T[]]): T[] {
  const source = toObject(this, "Array.prototype.toSpliced");
  const length = toLength(source.length);
  const relativeStart = toIntegerOrInfinity(args[0]);
  const start = relativeStart < 0 ? Math.max(length + relativeStart, 0) : Math.min(relativeStart, length);
  const items = args.slice(2) as T[];
  // Arity matters: `toSpliced()` removes nothing, `toSpliced(n)` removes the
  // rest, `toSpliced(n, undefined)` removes nothing (ToIntegerOrInfinity(undefined) = 0).
  const skipCount =
    args.length === 0
      ? 0
      : args.length === 1
        ? length - start
        : Math.min(Math.max(toIntegerOrInfinity(args[1]), 0), length - start);
  const newLength = length + items.length - skipCount;
  if (newLength > MAX_SAFE_LENGTH)
    throw new TypeError("Array.prototype.toSpliced result exceeds the maximum array length");
  const result = new Array<unknown>(newLength);
  let target = 0;
  for (let index = 0; index < start; index += 1) result[target++] = source[index];
  for (const item of items) result[target++] = item;
  for (let index = start + skipCount; index < length; index += 1) result[target++] = source[index];
  return result as T[];
}

export function arrayWith<T>(this: unknown, index: number, value: T): T[] {
  const { copy, length } = copyIndexed(this, "Array.prototype.with");
  const relativeIndex = toIntegerOrInfinity(index);
  const actualIndex = relativeIndex >= 0 ? relativeIndex : length + relativeIndex;
  if (actualIndex >= length || actualIndex < 0) throw new RangeError("Invalid index for Array.prototype.with");
  copy[actualIndex] = value;
  return copy as T[];
}

// ----- ES2024: well-formed Unicode strings -----

// With the `u` flag a paired surrogate reads as one supplementary code point,
// so `\p{Surrogate}` (General_Category=Cs) can only ever match a lone one.
const loneSurrogate = /\p{Surrogate}/u;
const loneSurrogates = /\p{Surrogate}/gu;

export function stringIsWellFormed(this: unknown): boolean {
  toObject(this, "String.prototype.isWellFormed");
  return !loneSurrogate.test(String(this));
}

export function stringToWellFormed(this: unknown): string {
  toObject(this, "String.prototype.toWellFormed");
  return String(this).replace(loneSurrogates, "�");
}

// ----- Web API: AbortSignal.any (Safari 17.4+) -----

/**
 * `source` listeners referencing a dependent `AbortSignal.any` result. Kept
 * out of the signal itself so a collected dependent lets the registry drop
 * the listeners — an app-lifetime signal combined repeatedly must not
 * accumulate them (the native spec keeps the dependent signal weakly held by
 * its sources for the same reason).
 */
interface SourceListener {
  source: AbortSignal;
  listener: () => void;
}

/** The controller able to abort each dependent signal; the map holds it only
 * as long as the signal lives, since a controller strongly owns its signal. */
const dependentControllers = new WeakMap<AbortSignal, AbortController>();

const collectedDependents = new FinalizationRegistry<SourceListener[]>((listeners) => {
  for (const { source, listener } of listeners) source.removeEventListener("abort", listener);
});

export function abortSignalAny(this: typeof AbortSignal, signals: Iterable<AbortSignal>): AbortSignal {
  const dependent = new AbortController();
  const listeners: SourceListener[] = [];
  const detach = () => {
    for (const { source, listener } of listeners) source.removeEventListener("abort", listener);
    listeners.length = 0;
  };
  for (const source of signals) {
    if (source.aborted) {
      detach();
      return AbortSignal.abort(source.reason);
    }
    const weak = new WeakRef(dependent.signal);
    const listener = () => {
      // First source to abort wins; every listener leaves the sources then.
      detach();
      const signal = weak.deref();
      if (signal) dependentControllers.get(signal)?.abort(source.reason);
    };
    listeners.push({ source, listener });
    source.addEventListener("abort", listener);
  }
  dependentControllers.set(dependent.signal, dependent);
  collectedDependents.register(dependent.signal, listeners);
  return dependent.signal;
}

// ----- Installation -----

type Host = Record<PropertyKey, unknown>;

/** Define a built-in the way the engine would: writable, configurable, not
 * enumerable. Existing natives — including ones that arrived through a
 * WebView update after this shipped — are left untouched. */
function installMissing(host: Host, name: PropertyKey, implementation: (...args: never[]) => unknown): boolean {
  if (typeof host[name] === "function") return false;
  Object.defineProperty(host, name, { value: implementation, writable: true, configurable: true, enumerable: false });
  return true;
}

/** The spec lists every change-array-by-copy method in
 * `Array.prototype[@@unscopables]` so `with (array) {}` blocks stay unaffected. */
function markUnscopable(arrayPrototype: Host, name: string): void {
  const unscopables = arrayPrototype[Symbol.unscopables];
  if (unscopables && typeof unscopables === "object" && !(name in unscopables)) {
    (unscopables as Record<string, boolean>)[name] = true;
  }
}

export interface PolyfillGlobals {
  Promise: Host;
  Object: Host;
  Map: Host;
  Array: { prototype: Host };
  String: { prototype: Host };
  /** The `AbortSignal` constructor; absent in realms that predate it. */
  AbortSignal?: Host;
}

/** Install every missing built-in into `globals`. Returns the names that were
 * filled, for logging and tests; an empty array means the engine needed nothing. */
export function installEcmaScriptPolyfills(globals: PolyfillGlobals): string[] {
  const installed: string[] = [];
  const fill = (host: Host, name: string, implementation: (...args: never[]) => unknown, label: string) => {
    if (installMissing(host, name, implementation)) installed.push(label);
  };
  fill(globals.Promise, "withResolvers", promiseWithResolvers, "Promise.withResolvers");
  fill(globals.Object, "groupBy", objectGroupBy, "Object.groupBy");
  fill(globals.Map, "groupBy", mapGroupBy, "Map.groupBy");
  const arrayMethods = {
    toSorted: arrayToSorted,
    toReversed: arrayToReversed,
    toSpliced: arrayToSpliced,
    with: arrayWith,
  } as const;
  for (const [name, implementation] of Object.entries(arrayMethods)) {
    if (installMissing(globals.Array.prototype, name, implementation)) {
      installed.push(`Array.prototype.${name}`);
      markUnscopable(globals.Array.prototype, name);
    }
  }
  fill(globals.String.prototype, "isWellFormed", stringIsWellFormed, "String.prototype.isWellFormed");
  fill(globals.String.prototype, "toWellFormed", stringToWellFormed, "String.prototype.toWellFormed");
  if (globals.AbortSignal) fill(globals.AbortSignal, "any", abortSignalAny, "AbortSignal.any");
  return installed;
}

/** The names filled in this realm, for the boot log. */
export const installedPolyfills: readonly string[] = installEcmaScriptPolyfills(
  globalThis as unknown as PolyfillGlobals,
);
