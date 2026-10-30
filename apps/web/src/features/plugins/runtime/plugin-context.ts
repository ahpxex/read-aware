/**
 * Builds the `ctx` handed to a plugin's activate(). This is a POLICY shell:
 * the data surface itself is the shared domain layer (src/domain), built
 * here with origin `plugin:<id>`; this module adds what is plugin-specific —
 * manifest permission gating (docs/plugins/plugin-system.md §4), contribution
 * branding and disposal tracking, virtual-book bindings, and the service
 * capabilities. Gating is API-level — it prevents accidental overreach, not
 * malice; the trust boundary is installation itself (§2). Within a domain,
 * write implies read.
 *
 * Each surface lives in `./context/*`; this module only composes them, in the
 * order later facets rely on (book-grant narrowing replaces what the
 * unrestricted facet installed).
 */
import type { PluginReactionEvent } from "@read-aware/plugin-types";
import type { DomainActor } from "../../../platform/domain-actor";
import type { PluginBookAccess, PluginContext, PluginDisposable, PluginManifest } from "../lib/plugin-types";
import { resolvePluginCapabilities } from "./plugin-capabilities";
import { attachPluginEventReactions, bindPluginEventContext } from "./plugin-event-context";
import type { PluginEventReactions } from "./plugin-event-reactions";
import type { PluginLifecycleController } from "./plugin-lifecycle";
import type { PluginServiceParticipant } from "./plugin-services";
import { installAnnotationsDomain } from "./context/annotations";
import { contributionsFacet } from "./context/contributions";
import { installConversationsDomain } from "./context/conversations";
import { currentAppLocale } from "./context/helpers";
import { installHostServices } from "./context/host-services";
import { createPluginActivationKit, createPluginActorKit } from "./context/kit";
import { installLibraryDomain } from "./context/library";
import { installMemoryDomain } from "./context/memory";
import { installReaderUi } from "./context/reader-ui";
import { installReadingDomain } from "./context/reading";
import { servicesFacet } from "./context/services";
import { settingsDomainFacet } from "./context/settings";
import { restrictSettingsDomain } from "./context/settings-restricted";
import { installWorkspaceServices } from "./context/workspace";

export { currentAppLocale, pluginStoragePrefix } from "./context/helpers";

export type PluginContextRuntime = {
  context: PluginContext;
  lifecycle: PluginLifecycleController;
  reactions: PluginEventReactions;
  contextForActor(actor: DomainActor): PluginContext;
  registrationForActor<T extends PluginDisposable>(
    registration: T,
    actor: DomainActor,
  ): import("@read-aware/plugin-types").PluginEventRegistration<T>;
  serviceParticipant: PluginServiceParticipant;
};

export function buildPluginContext(
  manifest: PluginManifest,
  appVersion: string,
  disposables: PluginDisposable[],
  bookAccess: PluginBookAccess = { mode: "all" },
  serviceInvocation?: { origin: DomainActor; lineage: readonly string[] },
): PluginContextRuntime {
  const activation = createPluginActivationKit(manifest, appVersion, disposables, bookAccess, serviceInvocation);
  const { lifecycle, reactions, contributionHandles, serviceParticipant, selfOrigin } = activation;
  const contexts = new WeakMap<object, PluginContext>();
  const contextForActor = (operationActor: DomainActor): PluginContext => {
    if (typeof operationActor === "object") {
      const cached = contexts.get(operationActor);
      if (cached) return cached;
    }
    const kit = createPluginActorKit(activation, operationActor);
    const { domain } = kit;

    const ctx: PluginContext = {
      withEvent: ((event: PluginReactionEvent | undefined, registration?: PluginDisposable) =>
        registration === undefined
          ? bindPluginEventContext(event, reactions, contextForActor)
          : contributionHandles.bind(event, registration)) as PluginContext["withEvent"],
      manifest,
      appVersion,
      // Live read — the worker mirrors this via the sync channel instead.
      get locale() {
        return currentAppLocale();
      },
      lifecycle: activation.activationLifecycle,
      capabilities: resolvePluginCapabilities(manifest),
      grants: activation.grantedMetadata,
      domains: { settings: settingsDomainFacet(kit) },
      contributions: contributionsFacet(kit, () => ctx),
      services: servicesFacet(kit),
    };

    restrictSettingsDomain(kit, ctx);
    // The registry already applied domain permissions. These layers only adapt
    // host-only details such as tracked subscriptions and virtual-book bindings.
    if (domain.library) {
      installWorkspaceServices(kit, ctx, domain.library);
      installLibraryDomain(kit, ctx, domain.library);
    }
    if (domain.reading) {
      installReaderUi(kit, ctx, domain.reading);
      installReadingDomain(kit, ctx, domain.reading);
    }
    if (domain.annotations) installAnnotationsDomain(kit, ctx, domain.annotations);
    installConversationsDomain(kit, ctx);
    installMemoryDomain(kit, ctx);
    installHostServices(kit, ctx);

    attachPluginEventReactions(ctx, reactions);
    if (typeof operationActor === "object") contexts.set(operationActor, ctx);
    return ctx;
  };
  return {
    context: contextForActor(serviceInvocation?.origin ?? selfOrigin),
    lifecycle,
    reactions,
    contextForActor,
    registrationForActor: (registration, actor) => contributionHandles.withSource(registration, actor),
    serviceParticipant: serviceParticipant(serviceInvocation?.origin ?? selfOrigin),
  };
}
