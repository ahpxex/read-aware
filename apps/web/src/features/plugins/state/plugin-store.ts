/**
 * The contribution registries — the app-side heart of the plugin system.
 *
 * Jotai atoms on the default store so both worlds reach the same state: the
 * plugin host (non-React, during activate/deactivate) registers and disposes
 * contributions imperatively; surfaces subscribe with `useAtomValue` and update
 * reactively, which is what makes enable/disable instant.
 */
import { atom, getDefaultStore, type Getter, type Setter } from "jotai";
import { causalActor, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { AppError } from "@read-aware/core";
import { localKV } from "../../../platform/local-store";
import { observePluginCallbackOwners, releasePluginCallbacks } from "../runtime/plugin-callback-wire";
import { createLogger } from "../../../platform/logger";
import type { VirtualBookContent } from "../../reader/lib/virtual-book";
import type {
  ContributionKey,
  InstalledPlugin,
  PluginDisposable,
  PluginFormValues,
  PluginSelectOption,
  PluginView,
  RegisteredCommand,
  RegisteredContextAction,
  RegisteredAgentContextProvider,
  RegisteredAgentRetrievalProvider,
  RegisteredHeaderAction,
  RegisteredPluginFont,
  RegisteredVoiceProvider,
  RegisteredPluginTheme,
  RegisteredReaderMode,
  RegisteredSelectionAction,
  RegisteredTool,
  RegisteredMemoryCandidateProvider,
  PluginBookAccess,
  PluginInstallSource,
} from "../lib/plugin-types";
import { createContributionRegistry } from "./contribution-registry";
import { createInteractiveContributionRegistry } from "./interactive-contribution-registry";

const store = getDefaultStore();

// ─── Contribution registries ─────────────────────────────────────────────────

const selectionActionsRegistry = createInteractiveContributionRegistry<RegisteredSelectionAction>(
  "selectionActions",
  "run",
);
const headerActionsRegistry = createInteractiveContributionRegistry<RegisteredHeaderAction>("headerActions", "view");
const settingsPageRegistry = createInteractiveContributionRegistry<{
  key: ContributionKey;
  pluginId: string;
  pluginName: string;
  view(): PluginView | Promise<PluginView>;
}>("settingsPage", "view");
const contextActionsRegistry = createInteractiveContributionRegistry<RegisteredContextAction>("contextActions", "run");
const readerModesRegistry = createContributionRegistry<RegisteredReaderMode>("readerModes");
const commandsRegistry = createInteractiveContributionRegistry<RegisteredCommand>("commands", "run");
const toolsRegistry = createInteractiveContributionRegistry<RegisteredTool>("agentTools", "execute");
const agentContextProvidersRegistry =
  createContributionRegistry<RegisteredAgentContextProvider>("agentContextProviders");
const agentRetrievalProvidersRegistry =
  createContributionRegistry<RegisteredAgentRetrievalProvider>("agentRetrievalProviders");
const memoryCandidateProvidersRegistry =
  createContributionRegistry<RegisteredMemoryCandidateProvider>("memoryCandidateProviders");
const themesRegistry = createContributionRegistry<RegisteredPluginTheme>("themes");
const fontsRegistry = createContributionRegistry<RegisteredPluginFont>("fonts");
const voiceProvidersRegistry = createContributionRegistry<RegisteredVoiceProvider>("voiceProviders");

export const selectionActionsAtom = selectionActionsRegistry.atom;
export const headerActionsAtom = headerActionsRegistry.atom;
export const pluginSettingsPagesAtom = settingsPageRegistry.atom;
export const registerSettingsPageContribution = settingsPageRegistry.register;
export const contextActionsAtom = contextActionsRegistry.atom;
export const readerModesAtom = readerModesRegistry.atom;
export const pluginCommandsAtom = commandsRegistry.atom;
export const pluginToolsAtom = toolsRegistry.atom;
export const pluginAgentContextProvidersAtom = agentContextProvidersRegistry.atom;
export const pluginAgentRetrievalProvidersAtom = agentRetrievalProvidersRegistry.atom;
export const pluginMemoryCandidateProvidersAtom = memoryCandidateProvidersRegistry.atom;
export const pluginThemesAtom = themesRegistry.atom;
export const pluginFontsAtom = fontsRegistry.atom;
export const voiceProvidersAtom = voiceProvidersRegistry.atom;

/** Installed plugins (manifest + enabled + activation error), for settings. */
export const installedPluginsAtom = atom<InstalledPlugin[]>(stampEventCause([]));

/**
 * True once `initializePlugins` has enumerated and activated everything (or
 * decided there is nothing to run, e.g. in a plain browser). Appearance
 * resolution uses this to tell "plugin not started YET" (keep the persisted
 * boot skin) from "plugin genuinely gone" (fall back to system).
 */
export const pluginsReadyAtom = atom(false);

export function markPluginsReady(): void {
  store.set(pluginsReadyAtom, true);
}

export function registerSelectionActionContribution(item: RegisteredSelectionAction, source?: DomainActor) {
  return selectionActionsRegistry.register(item, source);
}

export function registerHeaderActionContribution(item: RegisteredHeaderAction, source?: DomainActor) {
  return headerActionsRegistry.register(item, source);
}

export function registerContextActionContribution(item: RegisteredContextAction, source?: DomainActor) {
  return contextActionsRegistry.register(item, source);
}

export function registerReaderModeContribution(item: RegisteredReaderMode, source?: DomainActor): PluginDisposable {
  return readerModesRegistry.register(item, source);
}

export function registerCommandContribution(item: RegisteredCommand, source?: DomainActor) {
  return commandsRegistry.register(item, source);
}

export function registerToolContribution(item: RegisteredTool, source?: DomainActor) {
  return toolsRegistry.register(item, source);
}

export function registerAgentContextProviderContribution(
  item: RegisteredAgentContextProvider,
  source?: DomainActor,
): PluginDisposable {
  return agentContextProvidersRegistry.register(item, source);
}

export function registerAgentRetrievalProviderContribution(
  item: RegisteredAgentRetrievalProvider,
  source?: DomainActor,
): PluginDisposable {
  // Cached Agent tools retain this identity, not just the reusable public key.
  return agentRetrievalProvidersRegistry.register({ ...item }, source);
}

export function registerMemoryCandidateProviderContribution(
  item: RegisteredMemoryCandidateProvider,
  source?: DomainActor,
): PluginDisposable {
  return memoryCandidateProvidersRegistry.register(item, source);
}

export function registerThemeContribution(item: RegisteredPluginTheme, source?: DomainActor) {
  return themesRegistry.register(item, source);
}

export function registerFontContribution(item: RegisteredPluginFont, source?: DomainActor) {
  return fontsRegistry.register(item, source);
}

export function registerVoiceProviderContribution(item: RegisteredVoiceProvider, source?: DomainActor) {
  return voiceProvidersRegistry.register(item, source);
}

/**
 * The bound options source of one declared `dynamicOptions` select field
 * (`ctx.contributions.settingsOptions.register`). The settings form looks its
 * provider up at resolve time; it still shares the same registry lifecycle.
 */
export type RegisteredSettingsOptions = {
  key: ContributionKey;
  pluginId: string;
  fieldId: string;
  resolve: (values: PluginFormValues) => Promise<PluginSelectOption[]>;
};

const settingsOptionsRegistry = createContributionRegistry<RegisteredSettingsOptions>("settingsOptions");

export function registerSettingsOptionsContribution(
  item: RegisteredSettingsOptions,
  source?: DomainActor,
): PluginDisposable {
  return settingsOptionsRegistry.register(item, source);
}

export function getSettingsOptionsProvider(pluginId: string, fieldId: string): RegisteredSettingsOptions | null {
  return settingsOptionsRegistry.find((provider) => provider.pluginId === pluginId && provider.fieldId === fieldId);
}

export type RegisteredContentProvider = {
  key: ContributionKey;
  pluginId: string;
  providerId: string;
  load: (bookKey: string) => Promise<VirtualBookContent>;
};

const contentProvidersRegistry = createContributionRegistry<RegisteredContentProvider>("contentProviders");

export const contentProvidersAtom = contentProvidersRegistry.atom;

export function registerContentProviderContribution(provider: RegisteredContentProvider, source?: DomainActor) {
  return contentProvidersRegistry.register(provider, source);
}

export function getContentProvider(pluginId: string, providerId: string): RegisteredContentProvider | null {
  return contentProvidersRegistry.find(
    (provider) => provider.pluginId === pluginId && provider.providerId === providerId,
  );
}

/** Refresh one provider's voice snapshot in place (settings changed). */
export function updateVoiceProviderVoices(
  key: ContributionKey,
  voices: RegisteredVoiceProvider["voices"],
  expected: RegisteredVoiceProvider,
  source?: DomainActor,
): RegisteredVoiceProvider | null {
  let replacement: RegisteredVoiceProvider | null = null;
  voiceProvidersRegistry.update(
    key,
    (entry) => {
      if (entry !== expected) return entry;
      replacement = { ...entry, voices };
      return replacement;
    },
    source,
  );
  return replacement;
}

/** Snapshot lookup for callers outside React's flow (style injection paths). */
/** Snapshot of the enabled plugins' agent tools (read per agent build). */
export function getRegisteredPluginTools(): RegisteredTool[] {
  return toolsRegistry.list();
}

export function getRegisteredAgentContextProviders(): RegisteredAgentContextProvider[] {
  return agentContextProvidersRegistry.list();
}

export function getRegisteredAgentRetrievalProviders(): RegisteredAgentRetrievalProvider[] {
  return agentRetrievalProvidersRegistry.list();
}

export function getRegisteredMemoryCandidateProviders(): RegisteredMemoryCandidateProvider[] {
  return memoryCandidateProvidersRegistry.list();
}

/** A mounted reader owns its selection; stale cleanup must not clear a newer book. */
const activeReaderModeAtom = atom<{ value: { owner: object; key: string | null } | null }>(
  stampEventCause({ value: null }),
);
/** Host-only selection envelope, including the cause of clearing a selection. */
export const activeReaderModeSourceAtom = activeReaderModeAtom;
export function setActiveReaderMode(owner: object, key: string | null, origin: DomainActor = "system"): void {
  const current = store.get(activeReaderModeAtom).value;
  if (current?.owner !== owner || current.key !== key)
    store.set(activeReaderModeAtom, stampEventCause({ value: { owner, key } }, causalActor(origin)));
}
export function releaseActiveReaderMode(owner: object, origin: DomainActor = "system"): void {
  if (store.get(activeReaderModeAtom).value?.owner === owner)
    store.set(activeReaderModeAtom, stampEventCause({ value: null }, causalActor(origin)));
}
export const textUnitReaderModeAtom = atom((get) => {
  const selection = get(activeReaderModeAtom).value;
  return (
    get(readerModesAtom).find(
      (mode) => mode.kind === "text-unit-navigator" && (!selection || mode.key === selection.key),
    ) ?? null
  );
});

export function setInstalledPlugins(plugins: InstalledPlugin[], origin: DomainActor = "system"): void {
  store.set(installedPluginsAtom, stampEventCause([...plugins], causalActor(origin)));
}

export function updateInstalledPlugin(
  id: string,
  patch: Partial<Omit<InstalledPlugin, "manifest">>,
  origin: DomainActor = "system",
): void {
  const current = store.get(installedPluginsAtom);
  const target = current.find((plugin) => plugin.manifest.id === id);
  if (!target || Object.entries(patch).every(([key, value]) => Object.is(target[key as keyof InstalledPlugin], value)))
    return;
  setInstalledPlugins(
    current.map((plugin) => (plugin.manifest.id === id ? { ...plugin, ...patch } : plugin)),
    origin,
  );
}

// ─── Enabled state (persisted) ───────────────────────────────────────────────

const ENABLED_KEY = "read-aware-plugins-enabled";
const BOOK_ACCESS_KEY = "read-aware-plugins-book-access";
export const PLUGIN_BOOK_ACCESS_STATE_INVALID = "plugin/object-access-state-invalid";

function readEnabledMap(): Record<string, boolean> {
  try {
    const raw = localKV.getItem(ENABLED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

/**
 * Manually dropped folders start disabled; installing through the app opts
 * in; BUILT-IN plugins default to enabled unless explicitly switched off.
 */
export function isPluginEnabled(id: string, builtin = false): boolean {
  const value = readEnabledMap()[id];
  return builtin ? value !== false : value === true;
}

export function persistPluginEnabled(id: string, enabled: boolean, origin: DomainActor = "user"): void {
  const map = readEnabledMap();
  map[id] = enabled;
  localKV.setItem(ENABLED_KEY, JSON.stringify(map), "local", causalActor(origin));
}

export function forgetPluginEnabled(id: string, origin: DomainActor = "user"): void {
  const map = readEnabledMap();
  delete map[id];
  localKV.setItem(ENABLED_KEY, JSON.stringify(map), "local", causalActor(origin));
}

// ─── Install provenance (persisted, device-local) ────────────────────────────

const INSTALL_SOURCE_KEY = "read-aware-plugins-install-source";

function readInstallSourceMap(): Record<string, PluginInstallSource> {
  try {
    const parsed: unknown = JSON.parse(localKV.getItem(INSTALL_SOURCE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, PluginInstallSource] => entry[1] === "marketplace" || entry[1] === "local",
      ),
    );
  } catch {
    // Unreadable provenance is unknown provenance: no silent updates, never a broader grant.
    return {};
  }
}

/** Where an installed plugin's files came from; undefined when it predates provenance tracking. */
export function pluginInstallSource(id: string): PluginInstallSource | undefined {
  return readInstallSourceMap()[id];
}

export function persistPluginInstallSource(
  id: string,
  source: PluginInstallSource,
  origin: DomainActor = "user",
): void {
  const map = readInstallSourceMap();
  map[id] = source;
  localKV.setItem(INSTALL_SOURCE_KEY, JSON.stringify(map), "local", causalActor(origin));
}

export function forgetPluginInstallSource(id: string, origin: DomainActor = "user"): void {
  const map = readInstallSourceMap();
  if (!(id in map)) return;
  delete map[id];
  localKV.setItem(INSTALL_SOURCE_KEY, JSON.stringify(map), "local", causalActor(origin));
}

type PluginBookAccessSource = "legacy-domain" | "user";
export type StoredPluginBookAccess = {
  grant: PluginBookAccess;
  source: PluginBookAccessSource;
};

function readBookAccessMap(): Record<string, unknown> {
  const raw = localKV.getItem(BOOK_ACCESS_KEY);
  if (raw === null) return Object.create(null) as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.assign(Object.create(null), parsed) as Record<string, unknown>;
    }
  } catch {
    /* Invalid saved authority must never become a broad legacy grant. */
  }
  throw new AppError("plugin/invalid-input", "Saved plugin book grants are invalid");
}

function normalizeBookAccess(value: unknown): PluginBookAccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { mode?: unknown; bookId?: unknown };
  if (candidate.mode === "all" || candidate.mode === "current") return { mode: candidate.mode };
  if (
    candidate.mode === "book" &&
    typeof candidate.bookId === "string" &&
    candidate.bookId.trim() &&
    candidate.bookId.length <= 512
  ) {
    return { mode: "book", bookId: candidate.bookId };
  }
  return null;
}

/** Only an absent entry is a legacy broad grant; malformed saved grants fail closed. */
export function getPluginBookAccess(id: string): StoredPluginBookAccess {
  const map = readBookAccessMap();
  if (!Object.hasOwn(map, id)) return { grant: { mode: "all" }, source: "legacy-domain" };
  const grant = normalizeBookAccess(map[id]);
  if (!grant) throw new AppError("plugin/invalid-input", "Saved plugin book grant is invalid");
  return { grant, source: "user" };
}

// Different plugins share one persisted map. Read it only after the previous
// write settles, including rollback after a failed native commit.
let bookAccessWriteTail: Promise<void> = Promise.resolve();
function writeBookAccess(id: string, grant: PluginBookAccess | null, origin: DomainActor): Promise<void> {
  origin = causalActor(origin);
  const work = bookAccessWriteTail.then(() => {
    const map = readBookAccessMap();
    if (grant) map[id] = grant;
    else delete map[id];
    return localKV.setItemAsync(BOOK_ACCESS_KEY, JSON.stringify(map), origin);
  });
  bookAccessWriteTail = settled(work);
  return work;
}

export function persistPluginBookAccess(
  id: string,
  grant: PluginBookAccess,
  origin: DomainActor = "user",
): Promise<void> {
  const captured = normalizeBookAccess(grant);
  if (!captured) return Promise.reject(new AppError("plugin/invalid-input", "Invalid plugin book grant"));
  return writeBookAccess(id, captured, origin);
}

export function forgetPluginBookAccess(id: string, origin: DomainActor = "user"): Promise<void> {
  return writeBookAccess(id, null, origin);
}

// ─── Placement (user-owned pinning; docs/plugins/plugin-system.md §7) ────────────────

/**
 * Pin caps are a sanity rail, not a curation stance — the user arranges their
 * own bars, folding starts only past this count.
 */
export const HEADER_PIN_LIMIT = 5;

export type PluginPlacement = {
  shelfHeader: ContributionKey[];
  readerHeader: ContributionKey[];
  selection: ContributionKey[];
};

const PLACEMENT_KEY = "read-aware-plugin-placement";

const EMPTY_PLACEMENT: PluginPlacement = { shelfHeader: [], readerHeader: [], selection: [] };

function readPlacement(): PluginPlacement {
  try {
    const raw = localKV.getItem(PLACEMENT_KEY);
    if (!raw) return EMPTY_PLACEMENT;
    const parsed = JSON.parse(raw) as Partial<PluginPlacement>;
    return {
      shelfHeader: Array.isArray(parsed.shelfHeader) ? parsed.shelfHeader : [],
      readerHeader: Array.isArray(parsed.readerHeader) ? parsed.readerHeader : [],
      selection: Array.isArray(parsed.selection) ? parsed.selection : [],
    };
  } catch {
    return EMPTY_PLACEMENT;
  }
}

const placementBaseAtom = atom<PluginPlacement>(readPlacement());

/** Pinned contribution keys per surface; persisted app-side, never plugin-side. */
export const pluginPlacementAtom = atom(
  (get) => get(placementBaseAtom),
  (_get, set, next: PluginPlacement) => {
    set(placementBaseAtom, next);
    localKV.setItem(PLACEMENT_KEY, JSON.stringify(next));
  },
);

// ─── Dialog surface requests ─────────────────────────────────────────────────

/**
 * A view a plugin action asked to open as a modal Dialog (the reader-side
 * container for selection-action results and palette commands). One at a time;
 * the host component consumes and clears it.
 */
export type PluginDialogRequest = {
  requestId: string;
  pluginId: string;
  pluginName: string;
  /** Null while the contribution is still resolving its host-rendered view. */
  view: PluginView | null;
  /** Original registered callback, not the host closure wrapping its inputs. */
  owner?: unknown;
  /**
   * The contribution failed: the dialog renders an in-place error state
   * (localized via the failure's stable `code` when it carries one) with a
   * retry, instead of vanishing into a corner toast. Raw error text is
   * logged at the catch site, never stored here.
   */
  failure?: { code?: string; retry?: () => void };
};

const pluginDialogStateAtom = atom<PluginDialogRequest | null>(null);
const dialogOwnerWatches = new WeakMap<PluginDialogRequest, () => void>();
const viewLog = createLogger("plugin-views");
function updatePluginDialog(
  get: Getter,
  set: Setter,
  update: PluginDialogRequest | null | ((previous: PluginDialogRequest | null) => PluginDialogRequest | null),
): void {
  const previous = get(pluginDialogStateAtom);
  let next = typeof update === "function" ? update(previous) : update;
  if (next === previous) return;
  if (next) {
    const request = next;
    try {
      dialogOwnerWatches.set(
        request,
        observePluginCallbackOwners([request.owner, request.view], () => {
          if (get(pluginDialogStateAtom)?.requestId === request.requestId) updatePluginDialog(get, set, null);
        }),
      );
    } catch (error) {
      viewLog.warn("Dialog owner is unavailable", error);
      try {
        releasePluginCallbacks(request.view);
      } catch (cleanupError) {
        viewLog.warn("Unavailable dialog cleanup failed", cleanupError);
      }
      next = null;
    }
  }
  set(pluginDialogStateAtom, next);
  if (previous) {
    dialogOwnerWatches.get(previous)?.();
    dialogOwnerWatches.delete(previous);
  }
  if (previous?.view !== next?.view) {
    try {
      releasePluginCallbacks(previous?.view, next?.view);
    } catch (error) {
      viewLog.warn("Retired dialog cleanup failed", error);
    }
  }
}
export const pluginDialogAtom = atom((get) => get(pluginDialogStateAtom), updatePluginDialog);

export function openPluginDialog(request: Omit<PluginDialogRequest, "requestId">): string {
  const requestId = crypto.randomUUID();
  store.set(pluginDialogAtom, { ...request, requestId });
  return requestId;
}

/** Fill a pending Dialog only if it still belongs to this request. */
export function resolvePluginDialog(requestId: string, view: PluginView): boolean {
  const current = store.get(pluginDialogAtom);
  if (current?.requestId !== requestId) {
    releasePluginCallbacks(view);
    return false;
  }
  store.set(pluginDialogAtom, { ...current, view, failure: undefined });
  return true;
}

/** Mark a pending Dialog failed (in-place error state) if it's still this request's. */
export function failPluginDialog(requestId: string, failure: { code?: string; retry?: () => void }): boolean {
  const current = store.get(pluginDialogAtom);
  if (current?.requestId !== requestId) return false;
  store.set(pluginDialogAtom, { ...current, view: null, failure });
  return true;
}

/** Close a pending Dialog without disturbing a newer request. */
export function closePluginDialog(requestId: string): boolean {
  if (store.get(pluginDialogAtom)?.requestId !== requestId) return false;
  store.set(pluginDialogAtom, null);
  return true;
}

// ─── Install consent (docs/plugins/plugin-system.md §2/§4) ───────────────────────────

import type { PluginManifest } from "../lib/plugin-types";
import { settled } from "../../../platform/write-settlement";

export type PluginInstallConsentRequest = {
  manifest: PluginManifest;
  books?: Array<{ id: string; title: string }>;
  resolve: (approved: boolean, grant?: PluginBookAccess) => void;
};

export type PluginInstallConsentResult = {
  approved: boolean;
  grant: PluginBookAccess;
};

/** The pending consent dialog request; the host component consumes it. */
export const pluginInstallConsentAtom = atom<PluginInstallConsentRequest | null>(null);

/**
 * Every install path funnels through this gate: show the manifest's declared
 * permissions and resolve with the user's decision before any activation.
 */
export function requestInstallConsent(
  manifest: PluginManifest,
  signal?: AbortSignal,
  books: Array<{ id: string; title: string }> = [],
): Promise<PluginInstallConsentResult> {
  signal?.throwIfAborted();
  if (store.get(pluginInstallConsentAtom)) return Promise.reject(new Error("Plugin consent is already open"));
  return new Promise((resolve) => {
    const request: PluginInstallConsentRequest = {
      manifest,
      books: books.map((book) => ({ id: book.id, title: book.title })),
      resolve: (approved, grant = { mode: "all" }) => {
        signal?.removeEventListener("abort", abort);
        if (store.get(pluginInstallConsentAtom) === request) store.set(pluginInstallConsentAtom, null);
        resolve({ approved, grant });
      },
    };
    const abort = () => request.resolve(false);
    signal?.addEventListener("abort", abort, { once: true });
    store.set(pluginInstallConsentAtom, request);
  });
}
