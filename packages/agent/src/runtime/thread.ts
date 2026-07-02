/**
 * 一个线程 = 一个 pi Agent 实例（doc §5 runtime/）。
 * 职责：从 ConversationPort 水化转录、每轮重建 system prompt、
 * 把 pi 的事件流翻译成 ThreadChunk、轮末持久化两条 TurnRecord（doc §10）。
 */
import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import type { ThreadChunk } from "../chunks";
import { buildSystemPrompt } from "../context/system-prompt";
import type { ResolveModel } from "../models/roles";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { buildThreadTools } from "../tools/library-tools";
import { AsyncQueue } from "./async-queue";
import { lastAssistantText, turnRecordsToMessages } from "./history";
import { windowByTurns } from "./windowing";

export interface SelectionAttachment {
  /** 选中的原文（"Ask AI about this" 的 context chip） */
  text: string;
  chapter?: string;
}

export interface SendTurnInput {
  text: string;
  attachments?: SelectionAttachment[];
  signal?: AbortSignal;
}

export interface AgentThreadOptions {
  scope: ThreadScope;
  deps: RuntimeDeps;
  resolveModel: ResolveModel;
  getApiKey: (provider: string) => string | undefined;
  /** transformContext 窗口大小（用户轮数），默认 12 */
  maxWindowTurns?: number;
}

const DEFAULT_WINDOW_TURNS = 12;

function formatUserMessage(input: SendTurnInput): string {
  if (!input.attachments?.length) return input.text;
  const quoted = input.attachments
    .map((attachment) => {
      const body = attachment.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return attachment.chapter ? `${body}\n> — ${attachment.chapter}` : body;
    })
    .join("\n\n");
  return `${quoted}\n\n${input.text}`;
}

export class AgentThread {
  readonly scope: ThreadScope;
  readonly key: string;

  private readonly deps: RuntimeDeps;
  private readonly resolveModel: ResolveModel;
  private readonly getApiKey: (provider: string) => string | undefined;
  private readonly maxWindowTurns: number;

  private agent: Agent | undefined;
  private busy = false;

  constructor(options: AgentThreadOptions) {
    this.scope = options.scope;
    this.key = threadScopeKey(options.scope);
    this.deps = options.deps;
    this.resolveModel = options.resolveModel;
    this.getApiKey = options.getApiKey;
    this.maxWindowTurns = options.maxWindowTurns ?? DEFAULT_WINDOW_TURNS;
  }

  /** 首次使用时创建 Agent 并从转录 store 水化历史。 */
  private async ensureAgent(): Promise<Agent> {
    if (this.agent) return this.agent;
    const model = this.resolveModel("smart");
    const records = await this.deps.conversations.load(this.key);
    const agent = new Agent({
      initialState: {
        model,
        tools: buildThreadTools(this.scope, this.deps),
        messages: turnRecordsToMessages(records, model),
      },
      transformContext: async (messages) => windowByTurns(messages, this.maxWindowTurns),
      getApiKey: this.getApiKey,
    });
    this.agent = agent;
    return agent;
  }

  private async refreshSystemPrompt(agent: Agent): Promise<void> {
    const [profile, book, shelf] = await Promise.all([
      this.deps.profile.getProfileSummary(),
      this.scope.kind === "book" ? this.deps.library.getBook(this.scope.bookId) : undefined,
      this.scope.kind === "global" ? this.deps.library.listBooks() : undefined,
    ]);
    agent.state.systemPrompt = buildSystemPrompt(this.scope, {
      book,
      profile,
      shelfSize: shelf?.length,
    });
  }

  async *sendTurn(input: SendTurnInput): AsyncGenerator<ThreadChunk> {
    if (this.busy) throw new Error(`thread ${this.key} is already streaming a turn`);
    this.busy = true;
    const queue = new AsyncQueue<AgentEvent>();
    let unsubscribe: (() => void) | undefined;
    try {
      const agent = await this.ensureAgent();
      await this.refreshSystemPrompt(agent);
      unsubscribe = agent.subscribe((event) => queue.push(event));

      const onAbort = () => agent.abort();
      input.signal?.addEventListener("abort", onAbort, { once: true });

      const userText = formatUserMessage(input);
      const startedAt = new Date().toISOString();
      let runError: unknown;
      const run = agent
        .prompt(userText)
        .then(() => agent.waitForIdle())
        .catch((error) => {
          runError = error;
        })
        .finally(() => {
          input.signal?.removeEventListener("abort", onAbort);
          queue.close();
        });

      yield { type: "status", status: "thinking" };
      for await (const event of queue) {
        switch (event.type) {
          case "message_update":
            if (event.assistantMessageEvent.type === "text_delta") {
              yield { type: "text", text: event.assistantMessageEvent.delta };
            }
            break;
          case "tool_execution_start":
            yield { type: "tool-step", phase: "start", tool: event.toolName };
            break;
          case "tool_execution_end":
            yield { type: "tool-step", phase: "end", tool: event.toolName, isError: event.isError };
            break;
          default:
            break;
        }
      }
      await run;
      if (runError) throw runError;
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);

      await this.deps.conversations.append(this.key, {
        role: "user",
        content: userText,
        createdAt: startedAt,
      });
      const answer = lastAssistantText(agent.state.messages);
      if (answer) {
        await this.deps.conversations.append(this.key, {
          role: "assistant",
          content: answer,
          createdAt: new Date().toISOString(),
        });
      }
    } finally {
      unsubscribe?.();
      this.busy = false;
    }
  }
}
