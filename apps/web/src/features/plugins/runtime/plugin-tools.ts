/**
 * Bridges plugin-registered tools into the agent runtime's AgentTool shape
 * (docs/plugin-system.md §8): namespaced `plugin_<id>_<name>`, provenance in
 * the description so the model knows the source, JSON results. Wired into
 * RuntimeDeps.extraTools; the registry snapshot is taken per agent build.
 */
import type {
  AgentExtensionContextBlock,
  AgentExtensionContextRequest,
  AgentTool,
  ExternalMemoryCandidate,
  ExternalMemoryCandidateRequest,
  ReferencePayload,
  ThreadScope,
  WordReference,
} from "@read-aware/agent";
import type {
  PluginAgentScope,
  RegisteredAgentRetrievalProvider,
  RegisteredTool,
} from "../lib/plugin-types";
import {
  getRegisteredAgentContextProviders,
  getRegisteredAgentRetrievalProviders,
  getRegisteredMemoryCandidateProviders,
  getRegisteredPluginTools,
} from "../state/plugin-store";
import { contributionText } from "../lib/plugin-i18n";

/**
 * A card-carrying tool result (PluginToolWordCards in the contract): the
 * reader gets full word cards at the tool's position, the model only `gist`.
 * Anything that doesn't match the shape (or whose cards fail the sanity
 * check) falls back to plain JSON serialization.
 */
function toWordReferences(result: unknown): { gist: unknown; words: WordReference[] } | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const candidate = result as { gist?: unknown; wordCards?: unknown };
  if (!Array.isArray(candidate.wordCards) || candidate.wordCards.length === 0) return null;
  const words: WordReference[] = [];
  for (const card of candidate.wordCards as Array<Record<string, unknown>>) {
    const entry = card?.entry as { headword?: unknown; senses?: unknown } | undefined;
    if (
      typeof card?.term !== "string" ||
      !card.term.trim() ||
      !entry ||
      typeof entry.headword !== "string" ||
      !Array.isArray(entry.senses)
    ) {
      return null;
    }
    words.push({
      term: card.term,
      language: typeof card.language === "string" ? card.language : "",
      entry: entry as WordReference["entry"],
      source: "lookup",
    });
  }
  return { gist: candidate.gist ?? null, words };
}

function sanitize(part: string): string {
  return part.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Exposed for the chat UI too — one place defines the wire name. */
export function pluginToolName(tool: RegisteredTool): string {
  return `plugin_${sanitize(tool.pluginId)}_${sanitize(tool.name)}`;
}

const EMPTY_PARAMETERS = { type: "object", properties: {}, additionalProperties: false };
const RETRIEVAL_PARAMETERS = {
  type: "object",
  properties: {
    query: { type: "string", description: "What to find in this plugin source." },
    limit: { type: "integer", minimum: 1, maximum: 10 },
  },
  required: ["query"],
  additionalProperties: false,
};

const MAX_PROVIDER_CONTEXT_BLOCKS = 3;
const MAX_RETRIEVAL_ITEMS = 10;
const MAX_RETRIEVAL_CONTENT = 2_000;
const MAX_MEMORY_CANDIDATES_PER_PROVIDER = 3;

function pluginScope(scope: ThreadScope): PluginAgentScope {
  return scope.kind === "book"
    ? { kind: "book", bookId: String(scope.bookId) }
    : { kind: "global", threadId: scope.threadId };
}

function supportsScope(
  contexts: Array<"book" | "global"> | undefined,
  scope: ThreadScope,
): boolean {
  return !contexts || contexts.includes(scope.kind);
}

function retrievalTool(provider: RegisteredAgentRetrievalProvider, scope: ThreadScope): AgentTool {
  return {
    name: `plugin_${sanitize(provider.pluginId)}_retrieve_${sanitize(provider.id)}`,
    label: provider.label,
    description: `[Plugin: ${provider.pluginName}] ${provider.description}`,
    parameters: RETRIEVAL_PARAMETERS as AgentTool["parameters"],
    execute: async (_toolCallId, raw) => {
      const params = (raw ?? {}) as { query?: unknown; limit?: unknown };
      const query = typeof params.query === "string" ? params.query.trim() : "";
      if (!query) throw new Error("query is required");
      const requested = typeof params.limit === "number" ? Math.floor(params.limit) : 5;
      const limit = Math.max(1, Math.min(MAX_RETRIEVAL_ITEMS, requested));
      const result = await provider.retrieve({ scope: pluginScope(scope), query, limit });
      const items = (Array.isArray(result) ? result : [])
        .slice(0, limit)
        .flatMap((item) => {
          const content = typeof item?.content === "string"
            ? item.content.trim().slice(0, MAX_RETRIEVAL_CONTENT)
            : "";
          if (!content) return [];
          return [{
            title: typeof item.title === "string" ? item.title.trim().slice(0, 160) : undefined,
            location:
              typeof item.location === "string" ? item.location.trim().slice(0, 240) : undefined,
            content,
          }];
        });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ source: provider.pluginName, items }) }],
        details: undefined,
      };
    },
  };
}

export function getPluginAgentTools(scope: ThreadScope): AgentTool[] {
  const tools = getRegisteredPluginTools()
    .filter((tool) => !tool.contexts || tool.contexts.includes(scope.kind))
    .map((tool): AgentTool => ({
    name: pluginToolName(tool),
    label: tool.label ? contributionText(tool.label) : `${tool.pluginName} · ${tool.name}`,
    // Provenance stays visible to the model; plugins describe only behavior.
    description: `[Plugin: ${tool.pluginName}] ${tool.description}`,
    // pi passes the schema through to the provider without TypeBox runtime
    // validation, so plain JSON Schema is the honest input type here.
    parameters: (tool.parameters ?? EMPTY_PARAMETERS) as AgentTool["parameters"],
    execute: async (_toolCallId, params) => {
      const result = await tool.execute((params ?? {}) as Record<string, unknown>);
      const cards = toWordReferences(result);
      if (cards) {
        const reference: ReferencePayload = { kind: "words", words: cards.words };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(cards.gist) }],
          details: { reference },
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result ?? null) }],
        details: undefined,
      };
    },
    }));
  const retrieval = getRegisteredAgentRetrievalProviders()
    .filter((provider) => supportsScope(provider.contexts, scope))
    .map((provider) => retrievalTool(provider, scope));
  return [...tools, ...retrieval];
}

export async function getPluginAgentContext(
  request: AgentExtensionContextRequest,
): Promise<AgentExtensionContextBlock[]> {
  const providers = getRegisteredAgentContextProviders().filter((provider) =>
    supportsScope(provider.contexts, request.scope)
  );
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const blocks = await provider.provide({
        scope: pluginScope(request.scope),
        userText: request.userText,
      });
      return (Array.isArray(blocks) ? blocks : [])
        .slice(0, MAX_PROVIDER_CONTEXT_BLOCKS)
        .map((block) => ({
          source: `${provider.pluginName} (${provider.pluginId}/${provider.id})`,
          title: block.title,
          content: block.content,
        }));
    }),
  );
  return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

export async function getPluginMemoryCandidates(
  request: ExternalMemoryCandidateRequest,
): Promise<ExternalMemoryCandidate[]> {
  const providers = getRegisteredMemoryCandidateProviders().filter((provider) =>
    supportsScope(provider.contexts, request.scope)
  );
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const candidates = await provider.propose({
        scope: pluginScope(request.scope),
        userText: request.userText,
        assistantText: request.assistantText,
      });
      return (Array.isArray(candidates) ? candidates : [])
        .slice(0, MAX_MEMORY_CANDIDATES_PER_PROVIDER)
        .flatMap((candidate): ExternalMemoryCandidate[] => {
          const scope = candidate.scope === "book" && request.scope.kind === "book"
            ? (`book:${request.scope.bookId}` as const)
            : candidate.scope === "user" || candidate.scope === "global"
              ? candidate.scope
              : null;
          return scope ? [{ ...candidate, scope }] : [];
        });
    }),
  );
  return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}
