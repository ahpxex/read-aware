/**
 * System prompt 装配 v0（doc §5）：scope 的角色 framing + 画像摘要 + 书籍概况。
 * bundle 体系成型后（book_memory / reading_intent / conversation_insights）
 * 在这里逐段注入；每轮 sendTurn 前重建，保证 bundle 更新即时生效。
 */
import type { BookOverview, MemoryRecord } from "../ports";
import type { ThreadScope } from "../thread-scope";

export interface SystemPromptInput {
  /** book scope 的当前书；global scope 不传 */
  book?: BookOverview;
  /** user_profile_context v0：一段画像摘要文本 */
  profile?: string;
  /** global scope 的书架规模，帮模型建立范围感 */
  shelfSize?: number;
  /** 注入的高置信记忆（book_memory / user 记忆 bundle 的 v0） */
  memories?: MemoryRecord[];
}

const SHARED_RULES = `
Rules:
- Answer in the language the user writes in.
- Use your tools to look at the user's actual shelf, books, and annotations before answering questions about them.
- Ground your answers: clearly separate what comes from the user's books/annotations and what comes from your general knowledge.
- Be concise and substantive; no filler.`.trim();

export function buildSystemPrompt(scope: ThreadScope, input: SystemPromptInput): string {
  const sections: string[] = [];

  if (scope.kind === "book") {
    sections.push(
      "You are ReadAware's reading companion inside one specific book. You help the reader understand, question, and connect what they are reading right now.",
    );
    if (input.book) {
      const progress =
        input.book.progressFraction !== undefined
          ? ` The reader is about ${Math.round(input.book.progressFraction * 100)}% through.`
          : "";
      sections.push(
        `Current book: "${input.book.title}"${input.book.author ? ` by ${input.book.author}` : ""}.${progress}`,
      );
    }
  } else {
    sections.push(
      "You are ReadAware's librarian across the user's whole shelf. You answer questions about any book, connect ideas across books, and draw cross-book conclusions.",
    );
    if (input.shelfSize !== undefined) {
      sections.push(`The shelf currently holds ${input.shelfSize} book(s).`);
    }
  }

  if (input.profile) {
    sections.push(`About the reader:\n${input.profile}`);
  }

  if (input.memories?.length) {
    sections.push(
      `What you remember from earlier conversations (long-term memory; treat as context, verify with tools when it matters):\n${input.memories
        .map((memory) => `- [${memory.kind}] ${memory.content}`)
        .join("\n")}`,
    );
  }

  sections.push(SHARED_RULES);
  return sections.join("\n\n");
}
