import type {
  PluginAction,
  PluginDetailView,
  PluginDictionaryLanguage,
  PluginDocument,
  PluginListView,
  PluginMetadataItem,
  PluginSelectControl,
  PluginViewResult,
} from "@read-aware/plugin-types";
import { exportSavedWords } from "./export";
import { definitionOf, formatDate } from "./format";
import { isTargetLanguage, LANGUAGE_OPTIONS, LANGUAGE_VALUE_BY_NAME } from "./languages";
import type { DictionaryContext, SavedWord } from "./types";
import { changeWordLanguage, wordCollection } from "./words";

function wordDetail(
  word: SavedWord,
  targetLanguage: PluginDictionaryLanguage,
  onLanguageChange: PluginSelectControl["onChange"],
  onRemove: PluginAction["run"],
): PluginDetailView {
  const metadata: PluginMetadataItem[] = [
    ...(word.bookTitle
      ? [{ kind: "label" as const, label: "Book", value: word.bookTitle, icon: "book-open" }]
      : []),
    ...(formatDate(word.addedAt)
      ? [
          {
            kind: "label" as const,
            label: "Added",
            value: formatDate(word.addedAt),
            icon: "calendar",
          },
        ]
      : []),
  ];
  const passage =
    word.context &&
    word.context.trim().toLowerCase() !== word.term.trim().toLowerCase()
      ? word.context
      : undefined;

  return {
    kind: "detail",
    content: [
      { kind: "dictionary", entry: word.entry },
      ...(passage ? [{ kind: "quote" as const, text: passage, caption: word.bookTitle }] : []),
    ],
    metadata,
    controls: [
      {
        kind: "select",
        id: "target-language",
        label: "Target language",
        value: targetLanguage,
        icon: "translate",
        options: LANGUAGE_OPTIONS,
        onChange: onLanguageChange,
      },
    ],
    actions: [
      {
        id: "remove",
        label: "Delete word",
        icon: "trash",
        variant: "danger",
        run: onRemove,
      },
    ],
  };
}

export async function wordDetailView(
  ctx: DictionaryContext,
  doc: PluginDocument<SavedWord>,
): Promise<PluginDetailView> {
  const word = doc.data;
  const inferredLanguage =
    word.targetLanguage ??
    LANGUAGE_VALUE_BY_NAME[word.language] ??
    ctx.dictionary.getLanguage();
  const targetLanguage = isTargetLanguage(inferredLanguage)
    ? inferredLanguage
    : ctx.dictionary.getLanguage();

  return wordDetail(
    word,
    targetLanguage,
    async (nextLanguage): Promise<PluginViewResult> => {
      if (!isTargetLanguage(nextLanguage)) {
        throw new Error(`Unsupported target language: ${String(nextLanguage)}`);
      }
      if (nextLanguage === word.targetLanguage) return undefined;
      const nextDoc = await changeWordLanguage(ctx, doc, nextLanguage);
      return {
        view: await wordDetailView(ctx, nextDoc),
        navigation: "replace",
      };
    },
    async () => {
      await wordCollection(ctx).delete(doc.id);
      return { close: true, toast: `Deleted “${word.term}”` };
    },
  );
}

export async function notebookView(ctx: DictionaryContext): Promise<PluginListView> {
  const saved = await wordCollection(ctx).list<SavedWord>();
  return {
    kind: "list",
    emptyText: "No saved words yet. Select a word while reading and choose “Look up & save”.",
    searchable: true,
    searchPlaceholder: "Search saved words",
    timeline: true,
    actions: [
      {
        id: "export",
        label: "Export saved words",
        icon: "export",
        run: () => exportSavedWords(ctx, saved),
      },
    ],
    items: saved.map((doc) => ({
      id: doc.id,
      title: doc.data.term,
      subtitle: definitionOf(doc.data.entry),
      timestamp: doc.data.addedAt,
      icon: "book-bookmark",
      keywords: [doc.data.language, doc.data.bookTitle, doc.data.context].filter(
        (value): value is string => Boolean(value),
      ),
      accessories: doc.data.bookTitle
        ? [{ kind: "text", text: doc.data.bookTitle }]
        : undefined,
      presentation: "dialog",
      onSelect: async () => ({ view: await wordDetailView(ctx, doc) }),
    })),
  };
}
