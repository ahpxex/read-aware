import { scopePluginMemory } from "../plugin-scoped-memory";
import { AppError, canUseHostService, normalizeEntityQuery, normalizeProfileInspectionQuery } from "@read-aware/core";
import type { PluginContext } from "../../lib/plugin-types";
import type { PluginActorKit } from "./kit";

/** The memory domain, scoped to the book grant when restricted. */
export function installMemoryDomain(kit: PluginActorKit, ctx: PluginContext): void {
  const { permissions, lifecycle, callSignal, objectAccess, resources, domain, track } = kit;
  if (domain.memory) {
    const memory = domain.memory;
    ctx.domains.memory = {
      queries: {
        ...memory.queries,
        entities: (input, options) => {
          const query = normalizeEntityQuery(input);
          return lifecycle.read(
            "memory.entities",
            (signal) => memory.queries.entities(query, signal),
            callSignal(options),
          );
        },
        profileContext: (input, options) => {
          const query = normalizeProfileInspectionQuery(input);
          return lifecycle.read(
            "memory.profileContext",
            (signal) => memory.queries.profileContext(query, signal),
            callSignal(options),
          );
        },
        context: {
          history: (query, options) =>
            lifecycle.read(
              "memory.context.history",
              (signal) => memory.queries.context.history(query, signal),
              callSignal(options),
            ),
          read: (query, options) =>
            lifecycle.read(
              "memory.context.read",
              (signal) => memory.queries.context.read(query, signal),
              callSignal(options),
            ),
          // The sealed handle joins this activation's resource queue; retirement releases it with the rest.
          export: (query, options) =>
            lifecycle.read(
              "memory.context.export",
              (signal) => memory.queries.context.export(query, resources, signal),
              callSignal(options),
            ),
        },
      },
      events: { observe: (query, handler) => track(() => ({ dispose: memory.events.observe(query, handler) })) },
      ...(memory.commands
        ? {
            commands: {
              mutate: (input) => {
                lifecycle.assertActive("domains.memory.commands.mutate");
                return memory.commands!.mutate(input);
              },
              context: {
                capture: (selector, options) => {
                  lifecycle.assertActive("domains.memory.commands.context.capture");
                  return memory.commands!.context.capture(selector, callSignal(options));
                },
              },
              updateProfile: (input) => {
                lifecycle.assertActive("domains.memory.commands.updateProfile");
                return memory.commands!.updateProfile(input);
              },
              completeOnboarding: (input, options) => {
                lifecycle.assertActive("domains.memory.commands.completeOnboarding");
                return memory.commands!.completeOnboarding(input, callSignal(options));
              },
              decideEntity: (input, options) => {
                lifecycle.assertActive("domains.memory.commands.decideEntity");
                return memory.commands!.decideEntity(input, callSignal(options));
              },
              classify: (input) => {
                lifecycle.assertActive("domains.memory.commands.classify");
                return memory.commands!.classify(input);
              },
              startGraphTask: (bookId, mode, options) => {
                lifecycle.assertActive("domains.memory.commands.startGraphTask");
                if (!canUseHostService("llm", permissions))
                  throw new AppError("memory/forbidden", "Graph generation requires service:llm");
                return memory.commands!.startGraphTask(bookId, mode, options);
              },
              retryGraphTask: (bookId, taskId, options) => {
                lifecycle.assertActive("domains.memory.commands.retryGraphTask");
                if (!canUseHostService("llm", permissions))
                  throw new AppError("memory/forbidden", "Graph generation requires service:llm");
                return memory.commands!.retryGraphTask(bookId, taskId, options);
              },
              cancelGraphTask: (bookId, taskId) => {
                lifecycle.assertActive("domains.memory.commands.cancelGraphTask");
                return memory.commands!.cancelGraphTask(bookId, taskId);
              },
            },
          }
        : {}),
    };
  }

  if (objectAccess.restricted && domain.memory) {
    ctx.domains.memory = scopePluginMemory(
      domain.memory,
      objectAccess,
      lifecycle,
      resources,
      canUseHostService("llm", permissions),
    );
  }
}
