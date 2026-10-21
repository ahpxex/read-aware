// src/types.ts
function assertCapabilities(ctx) {
  if (!ctx.domains.library || !ctx.domains.reading?.commands)
    throw new Error("Jumper requires library:read and reading:write");
}

// src/chapters.ts
function flattenToc(entries) {
  return entries.flatMap((entry) => [entry, ...flattenToc(entry.children)]);
}
function chapterNumber(value) {
  const normalized = value.normalize("NFKC").trim();
  if (/^\d+$/.test(normalized)) {
    const number = Number(normalized);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  if (!/^[零〇一二两兩三四五六七八九十百千万萬]+$/.test(normalized))
    return null;
  const digits = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    兩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  const units = { 十: 10, 百: 100, 千: 1000, 万: 1e4, 萬: 1e4 };
  if (normalized.split("").every((char) => (char in digits))) {
    const number = Number(normalized.split("").map((char) => digits[char]).join(""));
    return number > 0 && Number.isSafeInteger(number) ? number : null;
  }
  let total = 0, section = 0, digit = 0;
  for (const char of normalized) {
    if (char in digits)
      digit = digits[char];
    else if (units[char] === 1e4) {
      total += (section + digit || 1) * 1e4;
      section = 0;
      digit = 0;
    } else {
      section += (digit || 1) * units[char];
      digit = 0;
    }
  }
  return total + section + digit || null;
}
function printedNumber(label) {
  const text = label.normalize("NFKC").trim();
  const match = text.match(/^第\s*([\d零〇一二两兩三四五六七八九十百千万萬]+)\s*[章节章節回]/u) ?? text.match(/^(?:chapter|chapitre|kapitel|capítulo|глава)\s+(\d+)\b/iu) ?? text.match(/^(\d+)(?:[.)、:\s]|$)/u);
  return match ? chapterNumber(match[1]) : null;
}
function findChapters(entries, query, mode) {
  const all = flattenToc(entries);
  const number = chapterNumber(query);
  if (mode === "ordinal")
    return number === null ? [] : all.filter((entry) => entry.ordinal === number);
  if (number !== null)
    return all.filter((entry) => printedNumber(entry.label) === number);
  const title = query.normalize("NFKC").trim().toLocaleLowerCase();
  return title ? all.filter((entry) => entry.label.normalize("NFKC").toLocaleLowerCase().includes(title)) : [];
}

// src/strings.ts
var locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"];
var strings = {
  searchQuery: ["Search", "搜索", "搜尋", "検索", "Поиск", "Recherche", "Suche", "Búsqueda"],
  invalidSearch: [
    "Search is too long or contains control characters.",
    "搜索内容过长或含控制字符。",
    "搜尋內容過長或含控制字元。",
    "検索文字列が長すぎるか、制御文字が含まれています。",
    "Запрос слишком длинный или содержит управляющие символы.",
    "La recherche est trop longue ou contient des caractères de contrôle.",
    "Die Suche ist zu lang oder enthält Steuerzeichen.",
    "La búsqueda es demasiado larga o contiene caracteres de control."
  ],
  clearSearch: [
    "Clear search",
    "清除搜索",
    "清除搜尋",
    "検索をクリア",
    "Очистить поиск",
    "Effacer la recherche",
    "Suche löschen",
    "Borrar búsqueda"
  ],
  searching: ["Searching", "搜索中", "搜尋中", "検索中", "Поиск", "Recherche en cours", "Suche läuft", "Buscando"],
  cancel: ["Cancel", "取消", "取消", "キャンセル", "Отмена", "Annuler", "Abbrechen", "Cancelar"],
  cancelled: [
    "Search cancelled.",
    "搜索已取消。",
    "搜尋已取消。",
    "検索をキャンセルしました。",
    "Поиск отменён.",
    "Recherche annulée.",
    "Suche abgebrochen.",
    "Búsqueda cancelada."
  ],
  goTo: [
    "Chapter, page or words to find",
    "章节、页码或要查找的文字",
    "章節、頁碼或要查找的文字",
    "章、ページ、または探す語句",
    "Глава, страница или слова для поиска",
    "Chapitre, page ou mots à trouver",
    "Kapitel, Seite oder gesuchte Wörter",
    "Capítulo, página o palabras que buscar"
  ],
  current: ["Current", "当前", "目前", "現在地", "Текущая", "Actuelle", "Aktuell", "Actual"],
  pageTitle: [
    "Page {n}",
    "第 {n} 页",
    "第 {n} 頁",
    "{n} ページ",
    "Страница {n}",
    "Page {n}",
    "Seite {n}",
    "Página {n}"
  ],
  searchText: [
    "Search the text for “{q}”",
    "在正文中搜索“{q}”",
    "在正文中搜尋「{q}」",
    "本文から「{q}」を検索",
    "Искать «{q}» в тексте",
    "Rechercher « {q} » dans le texte",
    "„{q}“ im Text suchen",
    "Buscar «{q}» en el texto"
  ],
  noToc: [
    "This book has no table of contents.",
    "这本书没有目录。",
    "這本書沒有目錄。",
    "この本には目次がありません。",
    "В этой книге нет оглавления.",
    "Ce livre n’a pas de table des matières.",
    "Dieses Buch hat kein Inhaltsverzeichnis.",
    "Este libro no tiene índice."
  ],
  search: ["Go", "前往", "前往", "移動", "Перейти", "Aller", "Los", "Ir"],
  back: ["Go back", "后退", "後退", "戻る", "Назад", "Reculer", "Zurück", "Atrás"],
  forward: ["Go forward", "前进", "前進", "進む", "Вперёд", "Avancer", "Vorwärts", "Adelante"],
  unavailable: [
    "This heading has no reading location.",
    "此目录标题没有可跳转的位置。",
    "此目錄標題沒有可跳轉的位置。",
    "この見出しには移動先がありません。",
    "У этого заголовка нет позиции для перехода.",
    "Ce titre n'a pas de destination.",
    "Diese Überschrift hat kein Sprungziel.",
    "Este título no tiene destino."
  ],
  noBook: [
    "Open a book to jump around in it.",
    "打开一本书后即可在书中跳转。",
    "開啟一本書後即可在書中跳轉。",
    "本を開くと、その中を移動できます。",
    "Откройте книгу, чтобы перемещаться по ней.",
    "Ouvrez un livre pour vous y déplacer.",
    "Öffnen Sie ein Buch, um darin zu springen.",
    "Abre un libro para moverte por él."
  ],
  noHits: [
    "No matches.",
    "没有匹配结果。",
    "沒有符合的結果。",
    "一致する結果はありません。",
    "Совпадений нет.",
    "Aucun résultat.",
    "Keine Treffer.",
    "Sin coincidencias."
  ],
  timedOut: [
    "Search timed out.",
    "搜索超时。",
    "搜尋逾時。",
    "検索がタイムアウトしました。",
    "Поиск превысил время ожидания.",
    "La recherche a expiré.",
    "Die Suche hat das Zeitlimit überschritten.",
    "La búsqueda agotó el tiempo."
  ],
  scanLimit: [
    "Search stopped at its section limit.",
    "搜索已达到分节上限。",
    "搜尋已達到分節上限。",
    "セクション上限で検索を停止しました。",
    "Поиск остановлен на лимите разделов.",
    "Recherche arrêtée à la limite de sections.",
    "Suche am Abschnittslimit angehalten.",
    "Búsqueda detenida en el límite de secciones."
  ],
  resultLimit: [
    "Search stopped at its result limit.",
    "搜索已达到结果上限。",
    "搜尋已達到結果上限。",
    "結果上限で検索を停止しました。",
    "Поиск остановлен на лимите результатов.",
    "Recherche arrêtée à la limite de résultats.",
    "Suche am Ergebnislimit angehalten.",
    "Búsqueda detenida en el límite de resultados."
  ],
  stale: [
    "The book changed; search again.",
    "书籍内容已变化，请重新搜索。",
    "書籍內容已變更，請重新搜尋。",
    "本の内容が変わりました。もう一度検索してください。",
    "Книга изменилась; выполните поиск снова.",
    "Le livre a changé ; relancez la recherche.",
    "Das Buch wurde geändert; suche erneut.",
    "El libro cambió; vuelve a buscar."
  ],
  textless: [
    "This book has no searchable text.",
    "这本书没有可搜索的文本。",
    "這本書沒有可搜尋的文字。",
    "この本には検索可能なテキストがありません。",
    "В книге нет текста для поиска.",
    "Ce livre ne contient aucun texte consultable.",
    "Dieses Buch enthält keinen durchsuchbaren Text.",
    "Este libro no tiene texto que buscar."
  ],
  unsupported: [
    "Text search is unavailable for some or all sections.",
    "部分或全部内容暂不支持文本搜索。",
    "部分或全部內容暫不支援文字搜尋。",
    "一部または全部の内容でテキスト検索が利用できません。",
    "Поиск недоступен для части или всей книги.",
    "La recherche est indisponible pour tout ou partie du livre.",
    "Die Textsuche ist für Teile oder das gesamte Buch nicht verfügbar.",
    "La búsqueda no está disponible en parte o todo el libro."
  ]
};
function tr(locale, key) {
  const exact = locales.findIndex((value) => value.toLowerCase() === locale.toLowerCase());
  const base = locales.findIndex((value) => value === locale.split("-")[0]);
  return strings[key][exact >= 0 ? exact : base >= 0 ? base : 0];
}
// ../../packages/core/src/host-commands.ts
var PARAMETERLESS_HOST_COMMAND_IDS = [
  "go-shelf",
  "go-context",
  "go-stats",
  "open-settings",
  "select",
  "layout-grid",
  "layout-list",
  "sort-recent",
  "sort-added",
  "sort-title",
  "sort-author",
  "sort-progress",
  "group-none",
  "group-status",
  "group-author",
  "group-format"
];
var HOST_COMMAND_IDS = [...PARAMETERLESS_HOST_COMMAND_IDS, "open-book", "open-collection"];
// ../../packages/core/src/domains.ts
var DOMAIN_CATALOG = {
  library: { version: "1.35.0", pluginAccess: ["read", "write"] },
  reading: { version: "2.24.0", pluginAccess: ["read", "write"] },
  annotations: { version: "2.2.0", pluginAccess: ["read", "write"] },
  conversations: { version: "1.6.0", pluginAccess: ["read", "write"] },
  settings: { version: "1.11.0", pluginAccess: [] },
  memory: { version: "2.8.0", pluginAccess: ["read", "write"] }
};
var DOMAIN_PERMISSIONS = Object.entries(DOMAIN_CATALOG).flatMap(([domain, definition]) => definition.pluginAccess.map((access) => `${domain}:${access}`));
var FULL_DOMAIN_GRANTS = Object.freeze(Object.fromEntries(Object.keys(DOMAIN_CATALOG).map((id) => [id, "write"])));
// ../../packages/core/src/capabilities.ts
var CONTRIBUTION_CATALOG = {
  uriHandlers: { version: "1.0.0", permission: null },
  selectionActions: { version: "1.2.0", permission: null },
  headerActions: { version: "1.2.0", permission: null },
  contextActions: { version: "1.0.0", permission: null },
  commands: { version: "1.1.0", permission: null },
  settingsOptions: { version: "1.0.0", permission: null },
  voiceProviders: { version: "1.0.0", permission: null },
  contentProviders: { version: "1.0.0", permission: null },
  readerModes: { version: "1.1.0", permission: "reader:modes" },
  agentTools: { version: "1.3.0", permission: "agent:tools" },
  agentContextProviders: { version: "1.1.0", permission: "agent:context" },
  agentRetrievalProviders: { version: "1.0.0", permission: "agent:retrieval" },
  memoryCandidateProviders: { version: "1.1.0", permission: "agent:memory" },
  themes: { version: "1.1.0", permission: "ui:themes" },
  fonts: { version: "1.0.0", permission: "ui:themes" },
  syncTransports: { version: "2.0.0", permission: "sync:transport" }
};
var HOST_SERVICE_CATALOG = {
  storage: { version: "2.6.0", permission: null },
  secrets: { version: "1.0.0", permission: null },
  ui: { version: "1.17.0", permission: null },
  schedules: { version: "2.1.0", permission: null },
  jobs: { version: "1.1.0", permission: null },
  changes: { version: "1.0.0", permission: null },
  transactions: { version: "1.0.0", permission: null },
  session: { version: "2.18.0", permission: null },
  plugins: { version: "1.10.0", permission: null },
  maintenance: { version: "1.5.0", permission: null },
  diagnostics: { version: "1.2.0", permission: "service:diagnostics" },
  logging: { version: "1.0.0", permission: null },
  resources: { version: "1.6.0", permission: null },
  sync: { version: "1.2.0", permission: "service:sync" },
  network: { version: "2.2.0", permission: "service:network" },
  llm: { version: "1.6.0", permission: "service:llm" },
  clipboard: { version: "1.1.0", permission: "service:clipboard" }
};
function declaredPermissions(catalog) {
  return [
    ...new Set(Object.values(catalog).flatMap((entry) => entry.permission === null ? [] : [entry.permission]))
  ];
}
var PLUGIN_PERMISSIONS = [
  ...DOMAIN_PERMISSIONS,
  ...declaredPermissions(CONTRIBUTION_CATALOG),
  ...declaredPermissions(HOST_SERVICE_CATALOG)
];
// ../../packages/core/src/context-bundle.ts
var CONTEXT_BUNDLE_MAX_BYTES = 1024 * 1024;
// ../../packages/core/src/resource-external-formats.json
var resource_external_formats_default = ["epub", "pdf", "txt", "fb2", "mobi", "azw", "azw3", "cbz", "cbr", "png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "heic", "mp3", "m4a", "wav", "ogg", "flac", "mp4", "m4v", "webm", "mov", "rtf", "docx", "odt", "xlsx", "ods", "pptx", "odp", "prc", "kf8", "fbz", "zip", "html", "htm"];

// ../../packages/core/src/resources.ts
var RESOURCE_EXTERNAL_EXTENSIONS = Object.freeze(resource_external_formats_default);
var RESOURCE_MAX_CHUNK = 1024 * 1024;
var RESOURCE_MAX_SIZE = 1024 * 1024 * 1024;
var RESOURCE_LIFETIME_MS = 60 * 60 * 1000;
// ../../packages/core/src/resource-download.ts
var RESOURCE_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
// ../../packages/core/src/book-images.ts
var BOOK_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
// ../../packages/core/src/plugin-assets.ts
var PLUGIN_ASSET_MAX_BYTES = 64 * 1024 * 1024;
var PLUGIN_ASSET_TOTAL_BYTES = 512 * 1024 * 1024;
// ../../packages/core/src/model-image.ts
var MODEL_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
var MODEL_IMAGES_MAX_BYTES = 16 * 1024 * 1024;
// ../../packages/core/src/plugin-services.ts
var PLUGIN_SERVICE_LIMITS = {
  bytes: 1024 * 1024,
  depth: 16,
  nodes: 16000,
  schemas: 512,
  timeoutMs: 120000
};
// ../../packages/plugin-types/src/book-location-search.ts
var HARD_MAX_SECTIONS = 256;
var HARD_MAX_HITS = 200;
var HARD_MAX_EXCERPT_BYTES = 64 * 1024;
var HARD_MAX_TIMEOUT_MS = 30000;
var MAX_PAGE_SIZE = 50;
var MAX_PAGE_CALLS = 256;
var HIT_OVERHEAD_BYTES = 128;
var TEXT_STATUSES = new Set([
  "available",
  "textless",
  "unsupported",
  "unsearched",
  "partial"
]);
function optionLimit(value, fallback, hardMax, name) {
  if (value === undefined)
    return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > hardMax) {
    throw Object.assign(new Error(`${name} is outside the bounded search limit`), {
      code: "library/invalid-search-options"
    });
  }
  return value;
}
function errorCode(error) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
function isStale(error) {
  const code = errorCode(error);
  return code === "reader/stale-location" || code === "reader/stale-content";
}
function isCancelled(error) {
  const code = errorCode(error);
  return code === "library/cancelled" || code === "plugin/cancelled" || typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}
function invalidPage(message) {
  return Object.assign(new Error(message), { code: "library/search-invalid-page" });
}
function validatePage(page, expectedBookId, expectedTotal, previousScanned, requestCursor) {
  if (!page || typeof page !== "object" || page.bookId !== expectedBookId || typeof page.contentVersion !== "string" || !page.contentVersion || !Array.isArray(page.hits) || page.hits.length > MAX_PAGE_SIZE || !Number.isSafeInteger(page.scannedSections) || page.scannedSections < 0 || !Number.isSafeInteger(page.totalSections) || page.totalSections < 0 || page.scannedSections > page.totalSections || page.scannedSections < previousScanned || expectedTotal !== null && page.totalSections !== expectedTotal || !TEXT_STATUSES.has(page.textStatus) || page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor || page.nextCursor.length > 1024)) {
    throw invalidPage("Search page counters or shape are invalid");
  }
  if (page.nextCursor === null && page.scannedSections !== page.totalSections) {
    throw invalidPage("A terminal search page must account for every section");
  }
  if (page.nextCursor !== null && page.nextCursor === requestCursor) {
    throw invalidPage("Search cursor did not advance");
  }
  for (const hit of page.hits) {
    if (!hit || typeof hit !== "object" || typeof hit.id !== "string" || !hit.excerpt || typeof hit.excerpt.pre !== "string" || typeof hit.excerpt.match !== "string" || typeof hit.excerpt.post !== "string") {
      throw invalidPage("Search page contains an invalid hit");
    }
  }
}
function combineSignal(source) {
  const controller = new AbortController;
  const abort = () => {
    if (!controller.signal.aborted)
      controller.abort();
  };
  if (source) {
    source.addEventListener("abort", abort, { once: true });
    if (source.aborted)
      abort();
  }
  return {
    signal: controller.signal,
    abort,
    dispose: () => source?.removeEventListener("abort", abort)
  };
}
function awaitAbortable(promise, signal, status) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled)
        return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => finish({ kind: "aborted", status: status() ?? "cancelled" });
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then((value) => finish({ kind: "value", value }), (error) => finish({ kind: "error", error }));
    if (signal.aborted)
      onAbort();
  });
}
function runResult(bookId, status, contentVersion, hits, scannedSections, totalSections, textStatus) {
  return { status, bookId, contentVersion, hits, scannedSections, totalSections, textStatus };
}
async function searchAllBookLocations(reader, input, options = {}) {
  const maxSections = optionLimit(options.maxSections, HARD_MAX_SECTIONS, HARD_MAX_SECTIONS, "maxSections");
  const maxHits = optionLimit(options.maxHits, HARD_MAX_HITS, HARD_MAX_HITS, "maxHits");
  const maxExcerptBytes = optionLimit(options.maxExcerptBytes, HARD_MAX_EXCERPT_BYTES, HARD_MAX_EXCERPT_BYTES, "maxExcerptBytes");
  const timeoutMs = optionLimit(options.timeoutMs, HARD_MAX_TIMEOUT_MS, HARD_MAX_TIMEOUT_MS, "timeoutMs");
  const encoder = new TextEncoder;
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  let timeoutHandle;
  const combined = combineSignal(options.signal);
  const abortStatus = () => {
    if (options.signal?.aborted)
      return "cancelled";
    if (timedOut || Date.now() >= deadline) {
      timedOut = true;
      return "timed-out";
    }
    return null;
  };
  timeoutHandle = setTimeout(() => {
    timedOut = true;
    combined.abort();
  }, timeoutMs);
  let version = null;
  let totalSections = 0;
  let expectedTotal = null;
  let scannedSections = 0;
  let textStatus = "unsearched";
  let cursor = input.cursor;
  let pageCalls = 0;
  let excerptBytes = 0;
  const hits = [];
  const seenCursors = new Set;
  if (cursor)
    seenCursors.add(cursor);
  const terminal = (status) => runResult(input.bookId, status, status === "stale" ? null : version, [], scannedSections, totalSections, textStatus);
  const emitProgress = async () => {
    const callback = options.onProgress;
    if (!callback)
      return null;
    const outcome = await awaitAbortable(Promise.resolve().then(() => callback({
      scannedSections,
      totalSections,
      hitCount: hits.length,
      contentVersion: version
    })), combined.signal, abortStatus);
    if (outcome.kind === "aborted")
      return terminal(outcome.status);
    if (outcome.kind === "error")
      throw outcome.error;
    return null;
  };
  try {
    if (abortStatus())
      return terminal(abortStatus());
    while (true) {
      if (pageCalls >= MAX_PAGE_CALLS)
        return runResult(input.bookId, "scan-limit", version, hits, scannedSections, totalSections, textStatus);
      const beforePage = abortStatus();
      if (beforePage)
        return terminal(beforePage);
      const request = {
        ...input,
        limit: Math.min(input.limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE, maxHits - hits.length || 1),
        ...cursor ? { cursor } : {},
        ...version ? { contentVersion: version } : {}
      };
      const pageOutcome = await awaitAbortable(Promise.resolve().then(() => reader(request, { signal: combined.signal })), combined.signal, abortStatus);
      if (pageOutcome.kind === "aborted")
        return terminal(pageOutcome.status);
      if (pageOutcome.kind === "error") {
        if (isStale(pageOutcome.error))
          return terminal("stale");
        if (isCancelled(pageOutcome.error))
          return terminal(abortStatus() ?? "cancelled");
        throw pageOutcome.error;
      }
      const page = pageOutcome.value;
      validatePage(page, input.bookId, expectedTotal, scannedSections, cursor);
      if (version !== null && page.contentVersion !== version)
        return terminal("stale");
      if (version === null) {
        if (input.contentVersion && page.contentVersion !== input.contentVersion)
          return terminal("stale");
        version = page.contentVersion;
      }
      if (page.nextCursor && seenCursors.has(page.nextCursor))
        throw invalidPage("Search cursor was repeated");
      if (expectedTotal === null)
        expectedTotal = page.totalSections;
      totalSections = expectedTotal;
      scannedSections = page.scannedSections;
      textStatus = page.textStatus;
      pageCalls++;
      const remainingBytes = maxExcerptBytes - excerptBytes;
      let resultLimited = false;
      for (const hit of page.hits) {
        const hitBytes = encoder.encode(hit.excerpt.pre).byteLength + encoder.encode(hit.excerpt.match).byteLength + encoder.encode(hit.excerpt.post).byteLength + HIT_OVERHEAD_BYTES;
        if (hits.length >= maxHits || hitBytes > remainingBytes || excerptBytes + hitBytes > maxExcerptBytes) {
          resultLimited = true;
          break;
        }
        hits.push(hit);
        excerptBytes += hitBytes;
      }
      const progressResult = await emitProgress();
      if (progressResult)
        return progressResult;
      if (resultLimited)
        return runResult(input.bookId, "result-limit", version, hits, scannedSections, totalSections, textStatus);
      const afterPage = abortStatus();
      if (afterPage)
        return terminal(afterPage);
      if (!page.nextCursor)
        return runResult(input.bookId, "completed", version, hits, scannedSections, totalSections, textStatus);
      if (hits.length >= maxHits)
        return runResult(input.bookId, "result-limit", version, hits, scannedSections, totalSections, textStatus);
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
      if (scannedSections >= maxSections)
        return runResult(input.bookId, "scan-limit", version, hits, scannedSections, totalSections, textStatus);
    }
  } finally {
    if (timeoutHandle !== undefined)
      clearTimeout(timeoutHandle);
    combined.dispose();
  }
}
// src/text-search.ts
function textSearchView(ctx, input) {
  const controller = new AbortController;
  let channel, revision = 0, started = false, pending = true;
  const retry = {
    id: "retry",
    label: tr(ctx.locale, "search"),
    icon: "magnifying-glass",
    run: () => ({ view: textSearchView(ctx, input), navigation: "replace" })
  };
  const cancelled = () => ({
    kind: "list",
    title: input.query,
    items: [],
    emptyText: tr(ctx.locale, "cancelled"),
    actions: [retry]
  });
  const progress = (value) => ({
    kind: "blocks",
    title: input.query,
    blocks: [
      {
        kind: "progress",
        value: value.totalSections ? Math.min(value.scannedSections, value.totalSections) : null,
        ...value.totalSections ? { max: value.totalSections, showValue: true } : {},
        label: value.totalSections ? `${tr(ctx.locale, "searching")} (${value.scannedSections}/${value.totalSections})` : tr(ctx.locale, "searching"),
        cancel: {
          id: "cancel",
          label: tr(ctx.locale, "cancel"),
          run: async () => {
            stop();
            await publish();
          }
        }
      }
    ]
  });
  const stop = () => {
    controller.abort();
    if (pending) {
      pending = false;
      current = cancelled();
    }
  };
  let current = {
    kind: "blocks",
    title: input.query,
    blocks: [
      {
        kind: "progress",
        value: null,
        label: tr(ctx.locale, "searching"),
        cancel: {
          id: "cancel",
          label: tr(ctx.locale, "cancel"),
          run: async () => {
            stop();
            await publish();
          }
        }
      }
    ]
  };
  const publish = async () => {
    if (!channel)
      return;
    const target = channel;
    try {
      const receipt = await ctx.services.ui.publishView(target, { revision: ++revision, view: current });
      if (receipt.status === "inactive" && channel === target) {
        channel = undefined;
        stop();
      }
    } catch (error) {
      console.warn("Jumper search view publication failed", error);
      if (channel === target) {
        channel = undefined;
        stop();
      }
    }
  };
  const search = async () => {
    await publish();
    if (controller.signal.aborted)
      return;
    try {
      const run = await searchAllBookLocations((pageInput, options) => ctx.domains.library.queries.books.searchLocations(pageInput, options), input, {
        signal: controller.signal,
        onProgress: async (value) => {
          if (controller.signal.aborted || !pending)
            return;
          current = progress(value);
          await publish();
        }
      });
      if (controller.signal.aborted)
        return;
      if (run.status === "cancelled") {
        pending = false;
        current = cancelled();
        await publish();
        return;
      }
      const emptyKey = run.status === "timed-out" ? "timedOut" : run.status === "scan-limit" ? "scanLimit" : run.status === "result-limit" ? "resultLimit" : run.status === "stale" ? "stale" : run.textStatus === "textless" ? "textless" : run.textStatus === "unsupported" || run.textStatus === "partial" ? "unsupported" : "noHits";
      const resultTitle = run.status === "completed" ? input.query : `${input.query} · ${tr(ctx.locale, emptyKey)}`;
      const result = {
        kind: "list",
        title: resultTitle,
        emptyText: tr(ctx.locale, emptyKey),
        items: run.hits.map((hit) => ({
          id: hit.id,
          title: hit.excerpt.pre + hit.excerpt.match + hit.excerpt.post,
          icon: "magnifying-glass",
          onSelect: async () => {
            await ctx.domains.reading.commands.goTo(hit.location);
            return { close: true };
          }
        })),
        actions: run.status === "timed-out" || run.status === "scan-limit" || run.status === "result-limit" ? [retry] : []
      };
      current = result;
    } catch (error) {
      if (controller.signal.aborted)
        return;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "library/content-unavailable";
      const retryable = ["db/locked", "library/text-extraction-failed", "library/text-busy"].includes(code);
      current = {
        kind: "blocks",
        title: input.query,
        blocks: [{ kind: "error", code }, ...retryable ? [{ kind: "actions", actions: [retry] }] : []]
      };
    }
    pending = false;
    await publish();
  };
  return {
    ...current,
    onClose: stop,
    live: {
      subscribe(next) {
        channel = next;
        if (!started) {
          started = true;
          search();
        } else
          publish();
        return {
          dispose() {
            if (channel === next) {
              channel = undefined;
              stop();
            }
          }
        };
      }
    }
  };
}

// src/views.ts
var PAGE_LABEL = /^\S{1,16}$/u;
var PAGE_LIMIT = 10;
async function jump(ctx, location) {
  await ctx.domains.reading.commands.goTo(location);
  return { close: true };
}
function matchChapters(entries, query) {
  const printed = findChapters(entries, query, "chapter");
  if (printed.length || chapterNumber(query) === null)
    return printed;
  return findChapters(entries, query, "ordinal");
}
function flattenWithParents(entries, parent = null) {
  return entries.flatMap((entry) => [{ entry, parent }, ...flattenWithParents(entry.children, entry)]);
}
function section(href) {
  return href ? href.split("#")[0] : null;
}
async function jumperView(ctx) {
  const session = await ctx.domains.reading.queries.session();
  if (!session.bookId)
    return {
      kind: "detail",
      title: "Jumper",
      content: [{ kind: "text", text: tr(ctx.locale, "noBook"), tone: "muted" }]
    };
  const bookId = session.bookId;
  const toc = await ctx.domains.library.queries.books.getNavigationToc(bookId);
  const chapters = flattenWithParents(toc.entries);
  const currentSection = section(session.location?.href);
  const guard = { sessionId: session.sessionId ?? undefined };
  const chapterItem = ({ entry, parent }) => {
    const current = currentSection !== null && section(entry.location?.href ?? undefined) === currentSection;
    return {
      id: `chapter:${entry.id}`,
      title: entry.label || String(entry.ordinal),
      icon: "book-open",
      subtitle: entry.location ? parent?.label || undefined : tr(ctx.locale, "unavailable"),
      ...current ? { accessories: [{ kind: "tag", text: tr(ctx.locale, "current") }] } : {},
      ...entry.location ? { onSelect: () => jump(ctx, entry.location) } : {}
    };
  };
  const pageItems = async (query) => {
    if (!PAGE_LABEL.test(query))
      return [];
    try {
      const page = await ctx.domains.library.queries.books.listNavigationTargets({
        bookId,
        contentVersion: toc.contentVersion,
        kind: "pages",
        label: query,
        limit: PAGE_LIMIT
      });
      if (page.status === "absent")
        return [];
      return page.items.filter((item) => item.location).map((item) => ({
        id: `page:${item.index}`,
        title: tr(ctx.locale, "pageTitle").replace("{n}", item.label ?? String(item.index + 1)),
        icon: "file-text",
        onSelect: () => jump(ctx, item.location)
      }));
    } catch (error) {
      console.warn("Jumper page lookup failed", error);
      return [];
    }
  };
  const rows = async (query) => {
    if (!query)
      return chapters.map(chapterItem);
    const byId = new Map(chapters.map((chapter) => [chapter.entry.id, chapter]));
    const matched = matchChapters(toc.entries, query).map((entry) => chapterItem(byId.get(entry.id) ?? { entry, parent: null }));
    const search2 = {
      id: "search",
      title: tr(ctx.locale, "searchText").replace("{q}", query),
      icon: "magnifying-glass",
      onSelect: () => ({ view: textSearchView(ctx, { bookId, query, limit: 20, matchCase: /\p{Lu}/u.test(query) }) })
    };
    return [...matched, ...await pageItems(query), search2];
  };
  const search = {
    placeholder: tr(ctx.locale, "goTo"),
    autoFocus: true,
    onQuery: async (query) => ({ view: list(await rows(query)) })
  };
  const actions = ["back", "forward"].map((direction) => ({
    id: direction,
    label: tr(ctx.locale, direction),
    icon: direction === "back" ? "arrow-left" : "arrow-right",
    priority: "primary",
    disabled: !(direction === "back" ? session.history.canGoBack : session.history.canGoForward),
    run: async () => {
      await ctx.domains.reading.commands[direction](guard);
      return { close: true };
    }
  }));
  const list = (items) => ({
    kind: "list",
    items,
    search,
    actions,
    emptyText: tr(ctx.locale, "noToc")
  });
  return list(await rows(""));
}

// src/bookmarks.ts
var BOOKMARKS = "bookmarks";
var bookmarkCollection = (ctx) => ctx.services.storage.collection(BOOKMARKS);
var object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
var text = (value, max) => typeof value === "string" && Boolean(value.trim()) && value.length <= max;
function bookmarkName(value) {
  return text(value, 120) ? value.trim() : null;
}
function bookmarkSearchQuery(value) {
  return typeof value === "string" && new TextEncoder().encode(value).length <= 1024 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) ? value.trim() : null;
}
function targetOf(raw) {
  if (!object(raw) || !text(raw.bookId, 512) || !text(raw.contentVersion, 256))
    return null;
  const target = { bookId: raw.bookId, contentVersion: raw.contentVersion };
  if (raw.cfi !== undefined) {
    if (!text(raw.cfi, 8192))
      return null;
    target.cfi = raw.cfi;
  } else if (raw.href !== undefined) {
    if (!text(raw.href, 8192))
      return null;
    target.href = raw.href;
  } else if (typeof raw.fraction === "number" && Number.isFinite(raw.fraction) && raw.fraction >= 0 && raw.fraction <= 1)
    target.fraction = raw.fraction;
  else
    return null;
  if (raw.textQuote !== undefined) {
    const quote = raw.textQuote;
    if (!object(quote) || !text(quote.exact, 12000))
      return null;
    target.textQuote = { exact: quote.exact };
    for (const key of ["prefix", "suffix"])
      if (quote[key] !== undefined) {
        if (typeof quote[key] !== "string" || quote[key].length > 2000)
          return null;
        target.textQuote[key] = quote[key];
      }
  }
  return target;
}
function parseBookmark(value) {
  if (!object(value) || value.version !== 1 || !bookmarkName(value.name) || !text(value.bookTitle, 500) || value.kind !== "location" && value.kind !== "selection")
    return null;
  const target = targetOf(value.target);
  if (!target || value.kind === "selection" && !target.cfi)
    return null;
  return { version: 1, name: bookmarkName(value.name), bookTitle: value.bookTitle, kind: value.kind, target };
}
async function captureBookmark(ctx, kind) {
  const session = await ctx.domains.reading.queries.session();
  if (session.status !== "ready" || !session.bookId || !session.location) {
    throw Object.assign(Error("Bookmark requires a ready reader"), { code: "reader/unavailable" });
  }
  const target = targetOf(kind === "selection" ? session.selection?.range : session.location);
  if (!target || target.bookId !== session.bookId || target.contentVersion !== session.location.contentVersion) {
    throw Object.assign(Error("Bookmark location is unavailable"), { code: "reader/stale-location" });
  }
  const selectionName = session.selection?.text.trim().slice(0, 120);
  const book = await ctx.domains.library.queries.books.get(target.bookId);
  if (!book)
    throw Object.assign(Error("Bookmark book missing"), { code: "library/book-not-found" });
  const bookTitle = book.title.trim().slice(0, 500) || book.id;
  return {
    version: 1,
    name: (kind === "selection" ? selectionName : bookTitle.slice(0, 120)) || bookTitle.slice(0, 120),
    bookTitle,
    kind,
    target
  };
}
async function writeBookmark(ctx, id, data, expectedRevision) {
  return ctx.services.storage.applyDocuments([
    {
      kind: "put",
      collection: BOOKMARKS,
      id,
      data,
      bookId: data.target.bookId,
      ...data.target.cfi ? { anchor: data.target.cfi } : {},
      expectedRevision
    }
  ]);
}
async function removeBookmark(ctx, doc) {
  return ctx.services.storage.applyDocuments([
    { kind: "delete", collection: BOOKMARKS, id: doc.id, expectedRevision: doc.revision }
  ]);
}
async function openBookmark(ctx, bookmark) {
  if (!await ctx.domains.library.queries.books.get(bookmark.target.bookId)) {
    throw Object.assign(Error("Bookmark book missing"), { code: "library/book-not-found" });
  }
  await ctx.domains.reading.commands.goTo(structuredClone(bookmark.target));
  return { close: true };
}

// src/bookmark-strings.ts
var en = {
  title: "Bookmarks",
  empty: "No bookmarks yet. Save the place you are reading to come back to it later.",
  name: "Name",
  save: "Save bookmark",
  saved: "Bookmark saved",
  current: "Save current location",
  selection: "Save selection",
  location: "Reading location",
  range: "Selected passage",
  open: "Go to bookmark",
  rename: "Rename",
  renamed: "Bookmark renamed",
  remove: "Delete",
  removed: "Bookmark deleted",
  confirm: "Delete this bookmark",
  invalidName: "Enter a name of 1–120 characters.",
  required: "Confirm deletion first.",
  invalid: "Unreadable bookmark",
  missing: "This bookmark no longer exists.",
  stale: "Bookmarks changed. Reload the list.",
  conflict: "This bookmark changed in the meantime. Reload before trying again.",
  refresh: "Refresh",
  all: "All books",
  thisBook: "This book only",
  book: "Book",
  kind: "Type",
  savedAt: "Saved"
};
var translations = {
  en,
  "zh-Hans": {
    title: "书签",
    empty: "还没有书签。保存正在读的位置，之后随时回来。",
    name: "名称",
    save: "保存书签",
    saved: "书签已保存",
    current: "保存当前位置",
    selection: "保存选中段落",
    location: "阅读位置",
    range: "选中段落",
    open: "跳转到书签",
    rename: "重命名",
    renamed: "书签已重命名",
    remove: "删除",
    removed: "书签已删除",
    confirm: "删除这条书签",
    invalidName: "请输入 1–120 个字符的名称。",
    required: "请先确认删除。",
    invalid: "无法读取的书签",
    missing: "这条书签已不存在。",
    stale: "书签列表已变化，请刷新。",
    conflict: "这条书签在此期间有变化，请刷新后再试。",
    refresh: "刷新",
    all: "全部书籍",
    thisBook: "仅当前书",
    book: "书籍",
    kind: "类型",
    savedAt: "保存于"
  },
  "zh-Hant": {
    title: "書籤",
    empty: "還沒有書籤。儲存正在讀的位置，之後隨時回來。",
    name: "名稱",
    save: "儲存書籤",
    saved: "書籤已儲存",
    current: "儲存目前位置",
    selection: "儲存選取段落",
    location: "閱讀位置",
    range: "選取段落",
    open: "跳轉到書籤",
    rename: "重新命名",
    renamed: "書籤已重新命名",
    remove: "刪除",
    removed: "書籤已刪除",
    confirm: "刪除這則書籤",
    invalidName: "請輸入 1–120 個字元的名稱。",
    required: "請先確認刪除。",
    invalid: "無法讀取的書籤",
    missing: "這則書籤已不存在。",
    stale: "書籤清單已變化，請重新整理。",
    conflict: "這則書籤在此期間有變化，請重新整理後再試。",
    refresh: "重新整理",
    all: "全部書籍",
    thisBook: "僅目前的書",
    book: "書籍",
    kind: "類型",
    savedAt: "儲存於"
  },
  ja: {
    title: "ブックマーク",
    empty: "ブックマークはまだありません。読んでいる場所を保存すると、あとで戻れます。",
    name: "名前",
    save: "ブックマークを保存",
    saved: "ブックマークを保存しました",
    current: "現在の位置を保存",
    selection: "選択範囲を保存",
    location: "読書位置",
    range: "選択した箇所",
    open: "ブックマークへ移動",
    rename: "名前を変更",
    renamed: "ブックマーク名を変更しました",
    remove: "削除",
    removed: "ブックマークを削除しました",
    confirm: "このブックマークを削除する",
    invalidName: "1〜120文字の名前を入力してください。",
    required: "先に削除を確認してください。",
    invalid: "読み取れないブックマーク",
    missing: "このブックマークはもう存在しません。",
    stale: "ブックマークが変わりました。一覧を再読み込みしてください。",
    conflict: "このブックマークはその間に変更されました。再読み込みしてやり直してください。",
    refresh: "更新",
    all: "すべての本",
    thisBook: "この本のみ",
    book: "本",
    kind: "種類",
    savedAt: "保存日時"
  },
  ru: {
    title: "Закладки",
    empty: "Закладок пока нет. Сохраните место, где вы читаете, чтобы вернуться к нему позже.",
    name: "Название",
    save: "Сохранить закладку",
    saved: "Закладка сохранена",
    current: "Сохранить текущее место",
    selection: "Сохранить выделение",
    location: "Место чтения",
    range: "Выделенный фрагмент",
    open: "Перейти к закладке",
    rename: "Переименовать",
    renamed: "Закладка переименована",
    remove: "Удалить",
    removed: "Закладка удалена",
    confirm: "Удалить эту закладку",
    invalidName: "Введите название длиной от 1 до 120 символов.",
    required: "Сначала подтвердите удаление.",
    invalid: "Нечитаемая закладка",
    missing: "Этой закладки больше нет.",
    stale: "Закладки изменились. Обновите список.",
    conflict: "Эта закладка тем временем изменилась. Обновите и попробуйте снова.",
    refresh: "Обновить",
    all: "Все книги",
    thisBook: "Только эта книга",
    book: "Книга",
    kind: "Тип",
    savedAt: "Сохранено"
  },
  fr: {
    title: "Signets",
    empty: "Aucun signet pour l’instant. Enregistrez l’endroit où vous lisez pour y revenir plus tard.",
    name: "Nom",
    save: "Enregistrer le signet",
    saved: "Signet enregistré",
    current: "Enregistrer la position actuelle",
    selection: "Enregistrer la sélection",
    location: "Position de lecture",
    range: "Passage sélectionné",
    open: "Aller au signet",
    rename: "Renommer",
    renamed: "Signet renommé",
    remove: "Supprimer",
    removed: "Signet supprimé",
    confirm: "Supprimer ce signet",
    invalidName: "Saisissez un nom de 1 à 120 caractères.",
    required: "Confirmez d’abord la suppression.",
    invalid: "Signet illisible",
    missing: "Ce signet n’existe plus.",
    stale: "Les signets ont changé. Rechargez la liste.",
    conflict: "Ce signet a changé entre-temps. Rechargez avant de réessayer.",
    refresh: "Actualiser",
    all: "Tous les livres",
    thisBook: "Ce livre seulement",
    book: "Livre",
    kind: "Type",
    savedAt: "Enregistré"
  },
  de: {
    title: "Lesezeichen",
    empty: "Noch keine Lesezeichen. Speichern Sie die Stelle, an der Sie lesen, um später dorthin zurückzukehren.",
    name: "Name",
    save: "Lesezeichen speichern",
    saved: "Lesezeichen gespeichert",
    current: "Aktuelle Stelle speichern",
    selection: "Auswahl speichern",
    location: "Leseposition",
    range: "Ausgewählte Textstelle",
    open: "Zum Lesezeichen",
    rename: "Umbenennen",
    renamed: "Lesezeichen umbenannt",
    remove: "Löschen",
    removed: "Lesezeichen gelöscht",
    confirm: "Dieses Lesezeichen löschen",
    invalidName: "Geben Sie einen Namen mit 1–120 Zeichen ein.",
    required: "Bestätigen Sie zuerst das Löschen.",
    invalid: "Unlesbares Lesezeichen",
    missing: "Dieses Lesezeichen existiert nicht mehr.",
    stale: "Die Lesezeichen haben sich geändert. Laden Sie die Liste neu.",
    conflict: "Dieses Lesezeichen hat sich inzwischen geändert. Laden Sie neu und versuchen Sie es erneut.",
    refresh: "Aktualisieren",
    all: "Alle Bücher",
    thisBook: "Nur dieses Buch",
    book: "Buch",
    kind: "Typ",
    savedAt: "Gespeichert"
  },
  es: {
    title: "Marcadores",
    empty: "Aún no hay marcadores. Guarda el lugar por el que vas para volver más tarde.",
    name: "Nombre",
    save: "Guardar marcador",
    saved: "Marcador guardado",
    current: "Guardar posición actual",
    selection: "Guardar selección",
    location: "Posición de lectura",
    range: "Pasaje seleccionado",
    open: "Ir al marcador",
    rename: "Renombrar",
    renamed: "Marcador renombrado",
    remove: "Eliminar",
    removed: "Marcador eliminado",
    confirm: "Eliminar este marcador",
    invalidName: "Escribe un nombre de 1 a 120 caracteres.",
    required: "Confirma primero la eliminación.",
    invalid: "Marcador ilegible",
    missing: "Este marcador ya no existe.",
    stale: "Los marcadores cambiaron. Recarga la lista.",
    conflict: "Este marcador cambió mientras tanto. Recarga antes de reintentar.",
    refresh: "Actualizar",
    all: "Todos los libros",
    thisBook: "Solo este libro",
    book: "Libro",
    kind: "Tipo",
    savedAt: "Guardado"
  }
};
var bookmarkCopy = (locale) => translations[locale] ?? translations[locale.split("-")[0]] ?? (locale.startsWith("zh") ? translations["zh-Hans"] : en);

// src/live-bookmarks.ts
async function liveBookmarks(ctx, query, read, render) {
  const failure = (errorCode2) => ({
    kind: "detail",
    title: bookmarkCopy(ctx.locale).title,
    content: [{ kind: "error", code: errorCode2 }],
    actions: [
      {
        id: "refresh",
        label: bookmarkCopy(ctx.locale).refresh,
        icon: "arrows-clockwise",
        run: async () => ({ view: await liveBookmarks(ctx, query, read, render), navigation: "replace" })
      }
    ]
  });
  const code = (error) => error && typeof error === "object" && ("code" in error) && typeof error.code === "string" ? error.code : "ipc/unknown";
  const content = async (result) => {
    try {
      return await render(result);
    } catch (error) {
      return failure(code(error));
    }
  };
  let initial;
  try {
    initial = await content(await read());
  } catch (error) {
    initial = failure(code(error));
  }
  return {
    ...initial,
    live: {
      subscribe(channel) {
        let disposed = false, revision = 0;
        const subscription = ctx.services.storage.observeDocuments(query, async (event, delivery) => {
          if (disposed)
            return;
          const reaction = ctx.withEvent(delivery);
          const view = event.status === "ready" ? await content(event.result) : failure(event.errorCode);
          if (!disposed)
            await reaction.services.ui.publishView(channel, { revision: ++revision, view });
        });
        return {
          dispose() {
            disposed = true;
            subscription.dispose();
          }
        };
      }
    }
  };
}

// src/bookmark-views.ts
function message(ctx, text2, refresh = () => bookmarksView(ctx)) {
  const t = bookmarkCopy(ctx.locale);
  return {
    kind: "detail",
    title: t.title,
    content: [{ kind: "text", text: text2 }],
    actions: [
      {
        id: "refresh",
        label: t.refresh,
        icon: "arrows-clockwise",
        priority: "primary",
        run: async () => ({ view: await refresh(), navigation: "reset" })
      }
    ]
  };
}
async function done(ctx, toast) {
  return { view: await bookmarksView(ctx), navigation: "reset", toast };
}
function nameForm(ctx, data, id, expectedRevision) {
  const t = bookmarkCopy(ctx.locale);
  return {
    kind: "form",
    title: expectedRevision === null ? t.save : t.rename,
    submitLabel: expectedRevision === null ? t.save : t.rename,
    fields: [{ id: "name", kind: "text", label: t.name, value: data.name }],
    onSubmit: async (values) => {
      const name = bookmarkName(values.name);
      if (!name)
        return { fieldErrors: { name: t.invalidName } };
      const receipt = await writeBookmark(ctx, id, { ...data, name }, expectedRevision);
      if (receipt.status === "conflict")
        return { view: message(ctx, t.conflict), navigation: "replace" };
      return done(ctx, expectedRevision === null ? t.saved : t.renamed);
    }
  };
}
async function saveBookmarkView(ctx, kind) {
  const data = await captureBookmark(ctx, kind), t = bookmarkCopy(ctx.locale);
  return {
    kind: "blocks",
    title: kind === "selection" ? t.selection : t.current,
    blocks: [
      {
        kind: "keyValue",
        rows: [
          { label: t.book, value: data.bookTitle },
          { label: t.kind, value: kind === "selection" ? t.range : t.location }
        ]
      },
      nameForm(ctx, data, crypto.randomUUID(), null)
    ]
  };
}
function deleteForm(ctx, doc) {
  const t = bookmarkCopy(ctx.locale), bookmark = parseBookmark(doc.data);
  return {
    kind: "form",
    title: bookmark?.name ?? t.invalid,
    submitLabel: t.remove,
    fields: [{ id: "confirm", kind: "checkbox", label: t.confirm, value: false }],
    onSubmit: async (values) => {
      if (values.confirm !== true)
        return { fieldErrors: { confirm: t.required } };
      const receipt = await removeBookmark(ctx, doc);
      if (receipt.status === "conflict")
        return { view: message(ctx, t.conflict), navigation: "replace" };
      return done(ctx, t.removed);
    }
  };
}
async function bookmarkDetail(ctx, id) {
  const t = bookmarkCopy(ctx.locale);
  return liveBookmarks(ctx, { kind: "get", collection: BOOKMARKS, id }, async () => ({ kind: "get", document: await bookmarkCollection(ctx).get(id) }), async (result) => {
    if (result.kind !== "get")
      throw Error("Expected bookmark document");
    const doc = result.document;
    if (!doc)
      return message(ctx, t.missing);
    const bookmark = parseBookmark(doc.data);
    const actions = [];
    if (bookmark)
      actions.push({
        id: "open",
        label: t.open,
        icon: "arrow-right",
        variant: "solid",
        priority: "primary",
        run: () => openBookmark(ctx, bookmark)
      }, {
        id: "rename",
        label: t.rename,
        icon: "pencil-simple",
        priority: "secondary",
        run: () => ({ view: nameForm(ctx, bookmark, doc.id, doc.revision) })
      });
    actions.push({
      id: "remove",
      label: t.remove,
      icon: "trash",
      variant: "danger",
      priority: "secondary",
      run: () => ({ view: deleteForm(ctx, doc) })
    }, {
      id: "refresh",
      label: t.refresh,
      icon: "arrows-clockwise",
      priority: "secondary",
      run: async () => ({ view: await bookmarkDetail(ctx, id), navigation: "replace" })
    });
    return {
      kind: "detail",
      title: bookmark?.name ?? t.invalid,
      content: bookmark ? [
        {
          kind: "keyValue",
          rows: [
            { label: t.book, value: bookmark.bookTitle },
            { label: t.kind, value: bookmark.kind === "selection" ? t.range : t.location },
            { label: t.savedAt, value: new Date(doc.updatedAt).toLocaleString(ctx.locale) }
          ]
        }
      ] : [{ kind: "alert", variant: "destructive", message: t.invalid }],
      actions
    };
  });
}
async function bookmarksView(ctx, bookId, cursors = [undefined], query) {
  const t = bookmarkCopy(ctx.locale);
  const filter = { bookId, limit: 40, cursor: cursors[cursors.length - 1], ...query ? { query } : {} };
  return liveBookmarks(ctx, { kind: "page", collection: BOOKMARKS, filter }, async () => ({ kind: "page", page: await bookmarkCollection(ctx).page(filter) }), async (result) => {
    if (result.kind !== "page")
      throw Error("Expected bookmark page");
    const page = result.page;
    if (page.status === "stale-cursor")
      return message(ctx, t.stale, () => bookmarksView(ctx, bookId, [undefined], query));
    const session = await ctx.domains.reading.queries.session();
    const ready = session.status === "ready" && session.location && session.bookId;
    const next = async (values) => ({
      view: await bookmarksView(ctx, bookId, values, query),
      navigation: "replace"
    });
    const actions = [];
    if (ready) {
      actions.push({
        id: "save-location",
        label: t.current,
        icon: "plus",
        variant: "solid",
        priority: "primary",
        run: async () => ({ view: await saveBookmarkView(ctx, "location") })
      });
      if (session.selection?.range)
        actions.push({
          id: "save-selection",
          label: t.selection,
          icon: "highlighter",
          priority: "primary",
          run: async () => ({ view: await saveBookmarkView(ctx, "selection") })
        });
    }
    actions.push({
      id: "search",
      label: tr(ctx.locale, "searchQuery"),
      icon: "magnifying-glass",
      priority: "secondary",
      run: () => ({
        view: {
          kind: "form",
          title: tr(ctx.locale, "searchQuery"),
          submitLabel: tr(ctx.locale, "searchQuery"),
          fields: [{ kind: "text", id: "query", label: tr(ctx.locale, "searchQuery"), value: query ?? "" }],
          onSubmit: async (values) => {
            const search = bookmarkSearchQuery(values.query);
            if (search === null)
              return { fieldErrors: { query: tr(ctx.locale, "invalidSearch") } };
            return {
              view: await bookmarksView(ctx, bookId, [undefined], search || undefined),
              navigation: "replace"
            };
          }
        }
      })
    });
    if (query)
      actions.push({
        id: "clear-search",
        label: tr(ctx.locale, "clearSearch"),
        icon: "arrows-clockwise",
        priority: "secondary",
        run: async () => ({ view: await bookmarksView(ctx, bookId), navigation: "replace" })
      });
    if (bookId)
      actions.push({
        id: "all",
        label: t.all,
        icon: "books",
        priority: "secondary",
        run: async () => ({
          view: await bookmarksView(ctx, undefined, [undefined], query),
          navigation: "replace"
        })
      });
    else if (ready)
      actions.push({
        id: "this-book",
        label: t.thisBook,
        icon: "book-open",
        priority: "secondary",
        run: async () => ({
          view: await bookmarksView(ctx, session.bookId, [undefined], query),
          navigation: "replace"
        })
      });
    actions.push({
      id: "refresh",
      label: t.refresh,
      icon: "arrows-clockwise",
      priority: "secondary",
      run: () => next([undefined])
    });
    return {
      kind: "list",
      title: t.title,
      emptyText: query ? tr(ctx.locale, "noHits") : t.empty,
      items: page.items.map((doc) => {
        const bookmark = parseBookmark(doc.data);
        return {
          id: doc.id,
          title: bookmark?.name ?? t.invalid,
          subtitle: bookmark?.bookTitle,
          icon: "book-bookmark",
          accessories: bookmark ? [{ kind: "tag", text: bookmark.kind === "selection" ? t.range : t.location }] : [],
          onSelect: async () => ({ view: await bookmarkDetail(ctx, doc.id) })
        };
      }),
      actions,
      pagination: {
        page: cursors.length,
        ...cursors.length > 1 ? { onPrevious: () => next(cursors.slice(0, -1)) } : {},
        ...page.nextCursor ? { onNext: () => next([...cursors, page.nextCursor]) } : {}
      }
    };
  });
}

// src/bookmark-tools.ts
var invalid = () => {
  throw Object.assign(Error("Invalid bookmark tool input"), { code: "plugin/invalid-input" });
};
function fields(params, allowed) {
  if (Object.keys(params).some((key) => !allowed.includes(key)))
    invalid();
}
function text2(value, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    return invalid();
  return value;
}
function kind(value) {
  if (value !== "location" && value !== "selection")
    return invalid();
  return value;
}
async function locationToken(bookmark) {
  const bytes = new TextEncoder().encode(JSON.stringify({ kind: bookmark.kind, target: bookmark.target }));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `bm1:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
var string = (maxLength = 512) => ({ type: "string", minLength: 1, maxLength });
function registerBookmarkTools(ctx) {
  if (!ctx.contributions.agentTools)
    throw Error("Jumper requires agent:tools");
  ctx.contributions.agentTools.register({
    name: "list_bookmarks",
    label: "List bookmarks",
    contexts: ["global"],
    description: "List a bounded page of Jumper bookmarks, optionally for an exact bookId and query. Query is a literal substring of any stored JSON key or scalar value (including nested fields), with Unicode lowercase matching, not regex, tokenization or accent folding. Maximum 1024 UTF-8 bytes, no controls; empty means unfiltered. Search runs over the whole collection before pagination. Returns ids and revisions for subsequent approved operations, not source text or raw locators. Keep the same book/query filters and returned cursor when paging. Any collection write invalidates the cursor: restart on stale-cursor. Invalid entries may be explicitly deleted, not opened or renamed.",
    parameters: {
      type: "object",
      properties: {
        bookId: string(),
        query: { type: "string", maxLength: 1024 },
        cursor: string(8192),
        limit: { type: "integer", minimum: 1, maximum: 20 }
      },
      additionalProperties: false
    },
    execute: async (params) => {
      fields(params, ["bookId", "cursor", "limit", "query"]);
      const query = params.query === undefined ? undefined : bookmarkSearchQuery(params.query);
      if (query === null)
        return invalid();
      const limit = params.limit ?? 10;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20)
        return invalid();
      const page = await bookmarkCollection(ctx).page({
        limit,
        ...query === undefined ? {} : { query },
        ...params.bookId === undefined ? {} : { bookId: text2(params.bookId) },
        ...params.cursor === undefined ? {} : { cursor: text2(params.cursor, 8192) }
      });
      if (page.status === "stale-cursor")
        return page;
      return {
        status: "ready",
        nextCursor: page.nextCursor,
        items: page.items.map((doc) => {
          const bookmark = parseBookmark(doc.data);
          return {
            id: doc.id,
            revision: doc.revision,
            valid: Boolean(bookmark),
            ...bookmark ? {
              name: bookmark.name,
              kind: bookmark.kind,
              bookId: bookmark.target.bookId,
              bookTitle: bookmark.bookTitle.slice(0, 160),
              bookTitleTruncated: bookmark.bookTitle.length > 160
            } : {}
          };
        })
      };
    }
  });
  ctx.contributions.agentTools.register({
    name: "inspect_bookmark_location",
    label: "Inspect bookmark location",
    contexts: ["global"],
    description: "Inspect the current reading location or readable selection before saving a Jumper bookmark. Returns book metadata and an opaque locationToken, not full source text. Does not save or navigate. Pass the unchanged kind, bookId and token to save_bookmark; that operation refuses a changed position or selection. A source may have session-limited validity.",
    parameters: {
      type: "object",
      properties: { kind: { type: "string", enum: ["location", "selection"] } },
      required: ["kind"],
      additionalProperties: false
    },
    execute: async (params) => {
      fields(params, ["kind"]);
      const bookmark = await captureBookmark(ctx, kind(params.kind));
      return {
        kind: bookmark.kind,
        bookId: bookmark.target.bookId,
        bookTitle: bookmark.bookTitle,
        suggestedName: bookmark.name,
        locationToken: await locationToken(bookmark)
      };
    }
  });
  ctx.contributions.agentTools.register({
    name: "save_bookmark",
    label: "Save bookmark",
    contexts: ["global"],
    approval: "required",
    description: "After host approval, save the current reading location or selection previously inspected with inspect_bookmark_location. Pass its exact kind, bookId and locationToken plus the requested name. Rechecks the target before writing and returns stale-location rather than capturing a different position. Saves only a private Jumper bookmark, not an annotation or reading-history event. Does not navigate. Repeated successful calls may create separate bookmarks.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["location", "selection"] },
        bookId: string(),
        locationToken: { type: "string", pattern: "^bm1:[a-f0-9]{64}$" },
        name: string(120)
      },
      required: ["kind", "bookId", "locationToken", "name"],
      additionalProperties: false
    },
    execute: async (params) => {
      fields(params, ["kind", "bookId", "locationToken", "name"]);
      const selectedKind = kind(params.kind), bookId = text2(params.bookId), token = text2(params.locationToken, 68), name = bookmarkName(params.name);
      if (!name || !/^bm1:[a-f0-9]{64}$/.test(token))
        return invalid();
      const bookmark = await captureBookmark(ctx, selectedKind);
      if (bookmark.target.bookId !== bookId || await locationToken(bookmark) !== token)
        return { status: "stale-location" };
      const id = crypto.randomUUID(), receipt = await writeBookmark(ctx, id, { ...bookmark, name }, null);
      return receipt.status === "conflict" ? { status: "conflict" } : { status: "saved", id, name, bookId };
    }
  });
  ctx.contributions.agentTools.register({
    name: "manage_bookmark",
    label: "Manage bookmark",
    contexts: ["global"],
    approval: "required",
    description: "Open, rename or permanently delete one Jumper bookmark after host approval. First list_bookmarks and pass the exact id and expectedRevision; a changed document returns conflict. Rename requires name; other actions must omit it. Open uses the stored book and content version through shared navigation, rejects removed/stale sources and never guesses a replacement location. Delete removes only this bookmark, not its book or annotations. Invalid entries can only be deleted.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["open", "rename", "delete"] },
        id: string(),
        expectedRevision: string(),
        name: string(120)
      },
      required: ["action", "id", "expectedRevision"],
      additionalProperties: false
    },
    execute: async (params) => {
      fields(params, ["action", "id", "expectedRevision", "name"]);
      const id = text2(params.id), expectedRevision = text2(params.expectedRevision);
      if (typeof params.action !== "string" || !["open", "rename", "delete"].includes(params.action))
        return invalid();
      const name = params.action === "rename" ? bookmarkName(params.name) : null;
      if (params.action === "rename" ? !name : params.name !== undefined)
        return invalid();
      const doc = await bookmarkCollection(ctx).get(id);
      if (!doc)
        return { status: "not-found", id };
      if (doc.revision !== expectedRevision)
        return { status: "conflict", id };
      if (params.action === "delete") {
        const receipt = await removeBookmark(ctx, doc);
        return { status: receipt.status === "conflict" ? "conflict" : "deleted", id };
      }
      const bookmark = parseBookmark(doc.data);
      if (!bookmark)
        return { status: "invalid-bookmark", id };
      if (params.action === "rename") {
        const receipt = await writeBookmark(ctx, id, { ...bookmark, name }, expectedRevision);
        return { status: receipt.status === "conflict" ? "conflict" : "renamed", id };
      }
      await openBookmark(ctx, bookmark);
      return { status: "completed", action: "open", id, bookId: bookmark.target.bookId };
    }
  });
}

// src/bookmark-service.ts
async function listBookmarkPage(ctx, input) {
  if (ctx.grants.book.mode !== "book")
    throw Object.assign(Error("A book is required"), { code: "plugin/object-access-denied" });
  const { cursor, limit = 20 } = input;
  const bookId = ctx.grants.book.bookId;
  const page = await ctx.services.storage.collection(BOOKMARKS).page({ bookId, limit, ...cursor === undefined ? {} : { cursor } });
  if (page.status === "stale-cursor")
    return { status: "stale-cursor", items: [], nextCursor: null };
  return {
    status: "ready",
    items: page.items.flatMap((doc) => {
      const bookmark = parseBookmark(doc.data);
      return bookmark?.target.bookId === bookId ? [{ id: doc.id, name: bookmark.name, kind: bookmark.kind }] : [];
    }),
    nextCursor: page.nextCursor
  };
}

// src/index.ts
var plugin = {
  services: { "bookmark-page": listBookmarkPage },
  activate(ctx) {
    assertCapabilities(ctx);
    registerBookmarkTools(ctx);
    const unavailable = { revision: 0, visible: true, enabled: false };
    const always = { revision: 0, visible: true, enabled: true };
    const header = ctx.contributions.headerActions.register({
      id: "jumper",
      title: "Jumper",
      icon: "magnifying-glass",
      state: unavailable,
      surface: "reader",
      presentation: "popup",
      view: () => jumperView(ctx)
    });
    const open = ctx.contributions.commands.register({
      id: "open",
      title: "Jumper",
      icon: "magnifying-glass",
      state: unavailable,
      keywords: "jump chapter page text search navigation",
      run: async () => ({ view: await jumperView(ctx) })
    });
    ctx.contributions.commands.register({
      id: "bookmarks",
      title: `Jumper: ${bookmarkCopy(ctx.locale).title}`,
      icon: "book-bookmark",
      state: always,
      keywords: "bookmark saved location passage",
      run: async () => ({ view: await bookmarksView(ctx) })
    });
    ctx.contributions.headerActions.register({
      id: "bookmarks",
      title: bookmarkCopy(ctx.locale).title,
      icon: "book-bookmark",
      state: always,
      surface: "reader",
      presentation: "popup",
      view: (input) => bookmarksView(ctx, input.book?.id)
    });
    const history = ["back", "forward"].map((direction) => ({
      direction,
      registration: ctx.contributions.commands.register({
        id: direction,
        title: `Jumper: ${tr(ctx.locale, direction)}`,
        state: unavailable,
        icon: direction === "back" ? "arrow-left" : "arrow-right",
        defaultShortcut: { key: direction === "back" ? "ArrowLeft" : "ArrowRight", alt: true },
        run: async () => {
          const session = await ctx.domains.reading.queries.session();
          await ctx.domains.reading.commands[direction]({ sessionId: session.sessionId ?? undefined });
        }
      })
    }));
    ctx.domains.reading.events.observeSession(async (session, delivery) => {
      if (delivery?.reaction?.status === "cycle")
        return;
      const state = { revision: session.revision + 1, visible: true, enabled: session.status === "ready" };
      await Promise.all([
        ctx.withEvent(delivery, header).updateState(state),
        ctx.withEvent(delivery, open).updateState(state),
        ...history.map(({ direction, registration }) => ctx.withEvent(delivery, registration).updateState({
          ...state,
          enabled: state.enabled && (direction === "back" ? session.history.canGoBack : session.history.canGoForward)
        }))
      ]);
    }, { ruleId: "reader-action-state" });
  }
};
var src_default = plugin;
export {
  src_default as default
};
