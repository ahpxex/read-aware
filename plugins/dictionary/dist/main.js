// src/format.ts
function idFor(term, language) {
  return `${language} ${term.trim().toLowerCase()}`;
}
function definitionOf(entry) {
  const first = entry.senses?.[0];
  if (!first)
    return entry.contextualMeaning ?? "";
  return first.partOfSpeech ? `(${first.partOfSpeech}) ${first.definition}` : first.definition;
}
function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}
function definitionForExport(entry) {
  return (entry.senses ?? []).map((sense) => [
    sense.partOfSpeech ? `${sense.partOfSpeech}: ${sense.definition}` : sense.definition,
    ...(sense.examples ?? []).map((example) => `Example: ${example}`)
  ].join(`
`)).join(`

`);
}
function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
function localDateStamp(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// src/languages.ts
var LANGUAGE_OPTIONS = [
  { value: "auto", label: "Match app language" },
  { value: "en", label: "English" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "ja", label: "日本語" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "ru", label: "Русский" },
  { value: "es", label: "Español" }
];
var LANGUAGE_NAME_BY_VALUE = {
  en: "English",
  "zh-Hans": "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  ja: "Japanese",
  fr: "French",
  de: "German",
  ru: "Russian",
  es: "Spanish"
};
var LANGUAGE_VALUE_BY_NAME = {
  English: "en",
  "Simplified Chinese": "zh-Hans",
  "Traditional Chinese": "zh-Hant",
  Japanese: "ja",
  French: "fr",
  German: "de",
  Russian: "ru",
  Spanish: "es"
};
function isTargetLanguage(value) {
  return LANGUAGE_OPTIONS.some((option) => option.value === value);
}

// src/lookup.ts
var LANGUAGE_KEY = "language";
var LOOKUPS_COLLECTION = "lookups";
function getTargetLanguage(ctx) {
  const raw = ctx.services.storage.get(LANGUAGE_KEY);
  return isTargetLanguage(raw) ? raw : "auto";
}
function saveTargetLanguage(ctx, language) {
  ctx.services.storage.set(LANGUAGE_KEY, language);
}
function resolveLanguageName(ctx, language) {
  const concrete = language === "auto" ? isTargetLanguage(ctx.locale) ? ctx.locale : "en" : language;
  return concrete === "auto" ? "English" : LANGUAGE_NAME_BY_VALUE[concrete];
}
var ENTRY_SCHEMA = {
  type: "object",
  properties: {
    headword: { type: "string", description: "The term, kept in its original language" },
    pronunciation: { type: "string", description: "IPA; omit when unsure" },
    senses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          partOfSpeech: { type: "string" },
          definition: { type: "string" },
          examples: { type: "array", items: { type: "string" } }
        },
        required: ["definition"]
      }
    },
    etymology: { type: "string", description: "Origin and roots; omit if genuinely unknown" },
    contextualMeaning: {
      type: "string",
      description: "What the term means in the provided sentence; omit when no context is given"
    }
  },
  required: ["headword", "senses"]
};
var SYSTEM_PROMPT = [
  "You are a meticulous lexicographer embedded in a reading app.",
  "Given a term (a word or short phrase) and, optionally, the sentence it appears in,",
  "produce a rich, accurate dictionary entry.",
  "Requirements: write detailed, precise definitions — never a bare one-word gloss;",
  "give 1–2 natural example sentences per sense; cover the common senses of the term;",
  "include etymology whenever you know it."
].join(" ");
function normalizeEntry(parsed, term) {
  const senses = Array.isArray(parsed.senses) ? parsed.senses.filter((sense) => !!sense && typeof sense.definition === "string").map((sense) => ({
    partOfSpeech: typeof sense.partOfSpeech === "string" ? sense.partOfSpeech : "",
    definition: sense.definition,
    examples: Array.isArray(sense.examples) ? sense.examples.filter((example) => typeof example === "string") : []
  })) : [];
  return {
    headword: typeof parsed.headword === "string" && parsed.headword.trim() ? parsed.headword.trim() : term,
    pronunciation: typeof parsed.pronunciation === "string" ? parsed.pronunciation : undefined,
    senses,
    etymology: typeof parsed.etymology === "string" ? parsed.etymology : undefined,
    contextualMeaning: typeof parsed.contextualMeaning === "string" ? parsed.contextualMeaning : undefined
  };
}
function cacheId(term, languageName, context) {
  const text = `${languageName}\x00${term.trim().toLowerCase()}\x00${context?.trim() ?? ""}`;
  let hash = 5381;
  for (let i = 0;i < text.length; i += 1) {
    hash = (hash * 33 ^ text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
async function lookUpTerm(ctx, input) {
  const term = input.term.trim();
  const languageName = resolveLanguageName(ctx, input.language ?? getTargetLanguage(ctx));
  const cache = ctx.services.storage.collection(LOOKUPS_COLLECTION);
  const id = cacheId(term, languageName, input.context);
  const cached = await cache.get(id);
  if (cached?.data?.entry && Array.isArray(cached.data.entry.senses)) {
    return { entry: cached.data.entry, language: languageName };
  }
  const prompt = [
    `Term to define: ${JSON.stringify(term)}.`,
    input.context ? `It appears in this passage: ${JSON.stringify(input.context)}.` : "",
    input.bookTitle ? `The book is ${JSON.stringify(input.bookTitle)}.` : "",
    "Write every human-readable field (definitions, part-of-speech labels, examples, " + `etymology, contextual meaning) in ${languageName}.`,
    "Keep the headword itself in its original language."
  ].filter(Boolean).join(`
`);
  const raw = await ctx.services.llm.ask({
    prompt,
    system: SYSTEM_PROMPT,
    schema: ENTRY_SCHEMA
  });
  const entry = normalizeEntry(raw, term);
  await cache.put(id, {
    term,
    language: languageName,
    entry,
    context: input.context,
    at: new Date().toISOString()
  });
  return { entry, language: languageName };
}

// src/words.ts
var WORDS_COLLECTION = "words";
function wordCollection(ctx) {
  return ctx.services.storage.collection(WORDS_COLLECTION);
}
async function saveWord(ctx, input) {
  const term = input.text.trim().slice(0, 60);
  const targetLanguage = input.language ?? getTargetLanguage(ctx);
  const { language, entry } = await lookUpTerm(ctx, {
    term,
    context: input.context,
    bookTitle: input.bookTitle,
    language: targetLanguage
  });
  const passage = input.context && input.context.trim().toLowerCase() !== term.toLowerCase() ? input.context.trim() : undefined;
  await wordCollection(ctx).put(idFor(term, language), {
    term,
    language,
    targetLanguage,
    entry,
    context: passage,
    bookTitle: input.bookTitle,
    addedAt: new Date().toISOString()
  }, { bookId: input.bookId });
  return { term, language, targetLanguage, entry };
}
async function changeWordLanguage(ctx, doc, targetLanguage) {
  if (!isTargetLanguage(targetLanguage)) {
    throw new Error(`Unsupported target language: ${String(targetLanguage)}`);
  }
  const word = doc.data;
  const { language, entry } = await lookUpTerm(ctx, {
    term: word.term,
    context: word.context,
    bookTitle: word.bookTitle,
    language: targetLanguage
  });
  const nextData = { ...word, language, targetLanguage, entry };
  const nextId = idFor(word.term, language);
  await wordCollection(ctx).put(nextId, nextData, {
    bookId: doc.bookId,
    anchor: doc.anchor
  });
  if (nextId !== doc.id)
    await wordCollection(ctx).delete(doc.id);
  saveTargetLanguage(ctx, targetLanguage);
  return {
    ...doc,
    id: nextId,
    data: nextData,
    updatedAt: new Date().toISOString()
  };
}

// src/agent-tools.ts
function registerAgentTools(ctx) {
  let currentBookTitle;
  ctx.services.session.subscribe("book-opened", ({ book }) => {
    currentBookTitle = book.title;
  });
  ctx.services.session.subscribe("book-closed", () => {
    currentBookTitle = undefined;
  });
  ctx.contributions.agentTools.register({
    name: "lookup_word",
    label: "Look up word",
    contexts: ["book", "global"],
    description: "Look up a word or short phrase in the AI dictionary and show the reader a word card with the full entry (pronunciation, senses, examples, etymology). Use it when the reader asks what a word means or when a precise definition genuinely helps; pass the surrounding sentence as context when you have it. The reader sees the full card; you receive only a one-line gist — the card IS the explanation, so after calling say nothing more about the definition, or add a single remark that ties the word to the passage or conversation. One lookup per word per reply: never call it again for a word whose card is already showing in this reply.",
    parameters: {
      type: "object",
      properties: {
        term: {
          type: "string",
          description: "The word or short phrase to define, in its original language."
        },
        context: {
          type: "string",
          description: "The sentence or passage it appears in — sharpens the contextual sense."
        }
      },
      required: ["term"],
      additionalProperties: false
    },
    execute: async (params) => {
      const term = String(params.term ?? "").trim();
      if (!term)
        throw new Error("term is required");
      const context = typeof params.context === "string" ? params.context : undefined;
      const { entry, language } = await lookUpTerm(ctx, {
        term,
        context,
        bookTitle: currentBookTitle
      });
      const headword = entry.headword || term;
      return {
        gist: {
          presented: headword,
          definition: entry.senses[0]?.definition,
          contextualMeaning: entry.contextualMeaning,
          note: "The reader is now looking at the full entry card (pronunciation, every sense with examples, etymology). Do not repeat any of it in prose."
        },
        wordCards: [{ term: headword, language, entry }]
      };
    }
  });
  ctx.contributions.agentTools.register({
    name: "get_vocabulary",
    label: "Saved words",
    contexts: ["book", "global"],
    description: "List the words the reader saved in Dictionary, each with a short definition and the book it came from. Call it WITHOUT query to see the whole list.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text filter over saved words. Omit to list all." },
        limit: { type: "number", description: "Max entries (default 50)." }
      },
      additionalProperties: false
    },
    execute: async (params) => {
      const needle = typeof params.query === "string" ? params.query.trim().toLowerCase() : "";
      const limit = typeof params.limit === "number" && params.limit > 0 ? Math.min(200, Math.floor(params.limit)) : 50;
      const saved = await wordCollection(ctx).list();
      return saved.map(({ data: word }) => ({
        term: word.term,
        language: word.language,
        definition: definitionOf(word.entry),
        bookTitle: word.bookTitle,
        context: word.context,
        addedAt: word.addedAt
      })).filter((word) => !needle || word.term.toLowerCase().includes(needle) || word.definition.toLowerCase().includes(needle)).slice(0, limit);
    }
  });
  ctx.contributions.agentTools.register({
    name: "save_word",
    label: "Save word",
    contexts: ["book", "global"],
    description: "Look up a word with the built-in Dictionary and save it. Include the sentence it appeared in when available.",
    parameters: {
      type: "object",
      properties: {
        word: { type: "string", description: "The word or phrase to save." },
        context: { type: "string", description: "The sentence it appeared in." },
        bookTitle: { type: "string", description: "Book title, if known." }
      },
      required: ["word"],
      additionalProperties: false
    },
    execute: async (params) => {
      const term = String(params.word ?? "").trim();
      if (!term)
        throw new Error("word is required");
      const { language } = await saveWord(ctx, {
        text: term,
        context: typeof params.context === "string" ? params.context : undefined,
        bookTitle: typeof params.bookTitle === "string" ? params.bookTitle : undefined
      });
      return {
        saved: term,
        language,
        total: (await wordCollection(ctx).list()).length
      };
    }
  });
}

// src/types.ts
function assertPluginCapabilities(ctx) {
  if (!ctx.services.llm) {
    throw new Error('Dictionary requires the "service:llm" permission');
  }
  if (!ctx.contributions.agentTools) {
    throw new Error('Dictionary requires the "agent:tools" permission');
  }
}

// src/export.ts
function savedWordsCsv(saved) {
  const rows = [
    [
      "Word",
      "Pronunciation",
      "Definition",
      "Etymology",
      "Contextual meaning",
      "Language",
      "Book",
      "Source context",
      "Added at"
    ],
    ...saved.map(({ data: word }) => [
      word.term,
      word.entry.pronunciation,
      definitionForExport(word.entry),
      word.entry.etymology,
      word.entry.contextualMeaning,
      word.language,
      word.bookTitle,
      word.context,
      word.addedAt
    ])
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join(`\r
`)}`;
}
async function exportSavedWords(ctx, saved) {
  const exported = await ctx.services.ui.exportFile({
    filename: `readaware-dictionary-${localDateStamp(new Date)}.csv`,
    content: savedWordsCsv(saved),
    mimeType: "text/csv;charset=utf-8"
  });
  if (!exported)
    return;
  return {
    toast: `Exported ${saved.length} saved ${saved.length === 1 ? "word" : "words"}`
  };
}

// src/views.ts
function wordDetail(word, targetLanguage, onLanguageChange, onRemove) {
  const metadata = [
    ...word.bookTitle ? [{ kind: "label", label: "Book", value: word.bookTitle, icon: "book-open" }] : [],
    ...formatDate(word.addedAt) ? [
      {
        kind: "label",
        label: "Added",
        value: formatDate(word.addedAt),
        icon: "calendar"
      }
    ] : []
  ];
  const passage = word.context && word.context.trim().toLowerCase() !== word.term.trim().toLowerCase() ? word.context : undefined;
  return {
    kind: "detail",
    content: [
      { kind: "dictionary", entry: word.entry },
      ...passage ? [{ kind: "quote", text: passage, caption: word.bookTitle }] : []
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
        onChange: onLanguageChange
      }
    ],
    actions: [
      {
        id: "remove",
        label: "Delete word",
        icon: "trash",
        variant: "danger",
        run: onRemove
      }
    ]
  };
}
async function wordDetailView(ctx, doc) {
  const word = doc.data;
  const inferredLanguage = word.targetLanguage ?? LANGUAGE_VALUE_BY_NAME[word.language] ?? getTargetLanguage(ctx);
  const targetLanguage = isTargetLanguage(inferredLanguage) ? inferredLanguage : getTargetLanguage(ctx);
  return wordDetail(word, targetLanguage, async (nextLanguage) => {
    if (!isTargetLanguage(nextLanguage)) {
      throw new Error(`Unsupported target language: ${String(nextLanguage)}`);
    }
    if (nextLanguage === word.targetLanguage)
      return;
    const nextDoc = await changeWordLanguage(ctx, doc, nextLanguage);
    return {
      view: await wordDetailView(ctx, nextDoc),
      navigation: "replace"
    };
  }, async () => {
    await wordCollection(ctx).delete(doc.id);
    return { close: true, toast: `Deleted “${word.term}”` };
  });
}
async function notebookView(ctx) {
  const saved = await wordCollection(ctx).list();
  return {
    kind: "list",
    emptyText: "No saved words yet. Select a word while reading and choose “Look up”.",
    searchable: true,
    searchPlaceholder: "Search saved words",
    timeline: true,
    actions: [
      {
        id: "export",
        label: "Export saved words",
        icon: "export",
        run: () => exportSavedWords(ctx, saved)
      }
    ],
    items: saved.map((doc) => ({
      id: doc.id,
      title: doc.data.term,
      subtitle: definitionOf(doc.data.entry),
      timestamp: doc.data.addedAt,
      icon: "book-bookmark",
      keywords: [doc.data.language, doc.data.bookTitle, doc.data.context].filter((value) => Boolean(value)),
      accessories: doc.data.bookTitle ? [{ kind: "text", text: doc.data.bookTitle }] : undefined,
      presentation: "dialog",
      onSelect: async () => ({ view: await wordDetailView(ctx, doc) })
    }))
  };
}

// src/index.ts
var plugin = {
  activate(ctx) {
    assertPluginCapabilities(ctx);
    ctx.contributions.selectionActions.register({
      id: "lookup-save",
      title: "Look up",
      icon: "book-bookmark",
      role: "lookup",
      presentation: "dialog",
      run: async (input) => {
        const { term, language } = await saveWord(ctx, {
          text: input.text,
          context: input.context ?? input.text.trim().slice(0, 300),
          bookId: input.book.id,
          bookTitle: input.book.title
        });
        const doc = await wordCollection(ctx).get(idFor(term, language));
        if (!doc)
          throw new Error(`Could not load saved word “${term}”`);
        return {
          toast: `Saved “${term}”`,
          view: await wordDetailView(ctx, doc)
        };
      }
    });
    ctx.contributions.headerActions.register({
      id: "vocabulary",
      title: "Dictionary",
      icon: "book-bookmark",
      surface: "shelf",
      presentation: "page",
      view: () => notebookView(ctx)
    });
    ctx.contributions.commands.register({
      id: "open",
      title: "Dictionary: saved words",
      icon: "book-bookmark",
      keywords: "saved words dictionary notebook",
      run: async () => ({ view: await notebookView(ctx) })
    });
    registerAgentTools(ctx);
  }
};
var src_default = plugin;
export {
  src_default as default
};
