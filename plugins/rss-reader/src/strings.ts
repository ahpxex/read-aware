/**
 * Runtime copy, resolved against the live app locale (`ctx.locale`): exact
 * tag, then base language, then the English default.
 */

type Localized = { default: string; [locale: string]: string };

const STRINGS = {
  addFeed: {
    default: "Add feed", "zh-Hans": "添加订阅", "zh-Hant": "新增訂閱", ja: "フィードを追加",
    ru: "Добавить ленту", fr: "Ajouter un flux", de: "Feed hinzufügen", es: "Añadir fuente",
  },
  importOpml: {
    default: "Import OPML", "zh-Hans": "导入 OPML", "zh-Hant": "匯入 OPML", ja: "OPMLをインポート",
    ru: "Импорт OPML", fr: "Importer un OPML", de: "OPML importieren", es: "Importar OPML",
  },
  refreshAll: {
    default: "Refresh all", "zh-Hans": "全部刷新", "zh-Hant": "全部重新整理", ja: "すべて更新",
    ru: "Обновить все", fr: "Tout actualiser", de: "Alle aktualisieren", es: "Actualizar todo",
  },
  feedUrlLabel: {
    default: "Feed URL", "zh-Hans": "订阅源地址", "zh-Hant": "訂閱來源網址", ja: "フィードURL",
    ru: "Адрес ленты", fr: "URL du flux", de: "Feed-URL", es: "URL de la fuente",
  },
  addFeedHelper: {
    default: "RSS and Atom feeds are read as books on your shelf — articles become chapters.",
    "zh-Hans": "RSS 和 Atom 订阅会作为书出现在书架上——文章成为章节。",
    "zh-Hant": "RSS 和 Atom 訂閱會作為書出現在書架上——文章成為章節。",
    ja: "RSS/Atomフィードは本棚の本として読めます。記事が章になります。",
    ru: "Ленты RSS и Atom читаются как книги на полке — статьи становятся главами.",
    fr: "Les flux RSS et Atom se lisent comme des livres — les articles deviennent des chapitres.",
    de: "RSS- und Atom-Feeds werden wie Bücher gelesen — Artikel werden zu Kapiteln.",
    es: "Las fuentes RSS y Atom se leen como libros: los artículos se vuelven capítulos.",
  },
  subscribe: {
    default: "Subscribe", "zh-Hans": "订阅", "zh-Hant": "訂閱", ja: "購読する",
    ru: "Подписаться", fr: "S'abonner", de: "Abonnieren", es: "Suscribirse",
  },
  opmlHelper: {
    default: "Paste the OPML export from your previous feed reader.",
    "zh-Hans": "粘贴你上一个阅读器导出的 OPML。",
    "zh-Hant": "貼上你上一個閱讀器匯出的 OPML。",
    ja: "以前のリーダーからエクスポートしたOPMLを貼り付けてください。",
    ru: "Вставьте OPML-экспорт из вашего прежнего ридера.",
    fr: "Collez l'export OPML de votre ancien lecteur.",
    de: "Fügen Sie den OPML-Export Ihres bisherigen Readers ein.",
    es: "Pega el OPML exportado de tu lector anterior.",
  },
  importAction: {
    default: "Import", "zh-Hans": "导入", "zh-Hant": "匯入", ja: "インポート",
    ru: "Импортировать", fr: "Importer", de: "Importieren", es: "Importar",
  },
  searchSubscriptions: {
    default: "Search subscriptions", "zh-Hans": "搜索订阅", "zh-Hant": "搜尋訂閱",
    ja: "購読を検索", ru: "Поиск по подпискам", fr: "Rechercher un abonnement",
    de: "Abos durchsuchen", es: "Buscar suscripciones",
  },
  searchArticles: {
    default: "Search articles", "zh-Hans": "搜索文章", "zh-Hant": "搜尋文章",
    ja: "記事を検索", ru: "Поиск по статьям", fr: "Rechercher un article",
    de: "Artikel durchsuchen", es: "Buscar artículos",
  },
  emptySubscriptions: {
    default: "No subscriptions yet — add your first feed.",
    "zh-Hans": "还没有订阅——添加第一个订阅源吧。",
    "zh-Hant": "還沒有訂閱——新增第一個訂閱來源吧。",
    ja: "まだ購読がありません。最初のフィードを追加しましょう。",
    ru: "Подписок пока нет — добавьте первую ленту.",
    fr: "Aucun abonnement — ajoutez votre premier flux.",
    de: "Noch keine Abos — fügen Sie Ihren ersten Feed hinzu.",
    es: "Aún no hay suscripciones: añade tu primera fuente.",
  },
  emptyArticles: {
    default: "No articles yet — refresh to load them.",
    "zh-Hans": "还没有文章——刷新以加载。",
    "zh-Hant": "還沒有文章——重新整理以載入。",
    ja: "記事がまだありません。更新して読み込んでください。",
    ru: "Статей пока нет — обновите, чтобы загрузить.",
    fr: "Pas encore d'articles — actualisez pour les charger.",
    de: "Noch keine Artikel — zum Laden aktualisieren.",
    es: "Aún no hay artículos: actualiza para cargarlos.",
  },
  openAsBook: {
    default: "Open as book", "zh-Hans": "作为书打开", "zh-Hant": "作為書開啟", ja: "本として開く",
    ru: "Открыть как книгу", fr: "Ouvrir comme livre", de: "Als Buch öffnen", es: "Abrir como libro",
  },
  refresh: {
    default: "Refresh", "zh-Hans": "刷新", "zh-Hant": "重新整理", ja: "更新",
    ru: "Обновить", fr: "Actualiser", de: "Aktualisieren", es: "Actualizar",
  },
  unsubscribe: {
    default: "Unsubscribe", "zh-Hans": "退订", "zh-Hant": "退訂", ja: "購読解除",
    ru: "Отписаться", fr: "Se désabonner", de: "Abbestellen", es: "Cancelar suscripción",
  },
  metaFeed: {
    default: "Feed", "zh-Hans": "订阅源", "zh-Hant": "訂閱來源", ja: "フィード",
    ru: "Лента", fr: "Flux", de: "Feed", es: "Fuente",
  },
  metaUpdated: {
    default: "Updated", "zh-Hans": "更新于", "zh-Hant": "更新於", ja: "更新",
    ru: "Обновлено", fr: "Mis à jour", de: "Aktualisiert", es: "Actualizado",
  },
  metaArticles: {
    default: "Articles", "zh-Hans": "文章", "zh-Hant": "文章", ja: "記事",
    ru: "Статьи", fr: "Articles", de: "Artikel", es: "Artículos",
  },
  /** `{n}` — the cached article count shown as a list tag. */
  articlesTag: {
    default: "{n} articles", "zh-Hans": "{n} 篇文章", "zh-Hant": "{n} 篇文章", ja: "{n}件の記事",
    ru: "Статей: {n}", fr: "{n} articles", de: "{n} Artikel", es: "{n} artículos",
  },
  articlesTagOne: {
    default: "1 article", "zh-Hans": "1 篇文章", "zh-Hant": "1 篇文章", ja: "1件の記事",
    ru: "1 статья", fr: "1 article", de: "1 Artikel", es: "1 artículo",
  },
  subscribedTo: {
    default: "Subscribed to “{title}”", "zh-Hans": "已订阅「{title}」", "zh-Hant": "已訂閱「{title}」",
    ja: "「{title}」を購読しました", ru: "Вы подписались на «{title}»",
    fr: "Abonné à « {title} »", de: "„{title}“ abonniert", es: "Suscrito a «{title}»",
  },
  unsubscribedFrom: {
    default: "Unsubscribed “{title}”", "zh-Hans": "已退订「{title}」", "zh-Hant": "已退訂「{title}」",
    ja: "「{title}」の購読を解除しました", ru: "Подписка на «{title}» отменена",
    fr: "Désabonné de « {title} »", de: "„{title}“ abbestellt", es: "Suscripción a «{title}» cancelada",
  },
  feedRefreshed: {
    default: "Feed refreshed", "zh-Hans": "已刷新", "zh-Hant": "已重新整理", ja: "更新しました",
    ru: "Лента обновлена", fr: "Flux actualisé", de: "Feed aktualisiert", es: "Fuente actualizada",
  },
  /** `{n}` — every feed refreshed. */
  refreshedAll: {
    default: "Refreshed {n} feeds", "zh-Hans": "已刷新 {n} 个订阅", "zh-Hant": "已重新整理 {n} 個訂閱",
    ja: "{n}件のフィードを更新しました", ru: "Обновлено лент: {n}",
    fr: "{n} flux actualisés", de: "{n} Feeds aktualisiert", es: "{n} fuentes actualizadas",
  },
  /** `{ok}` of `{total}` refreshed; the rest failed. */
  refreshedSome: {
    default: "Refreshed {ok} of {total} feeds", "zh-Hans": "刷新了 {total} 个订阅中的 {ok} 个",
    "zh-Hant": "重新整理了 {total} 個訂閱中的 {ok} 個",
    ja: "{total}件中{ok}件のフィードを更新しました", ru: "Обновлено {ok} из {total} лент",
    fr: "{ok} flux actualisés sur {total}", de: "{ok} von {total} Feeds aktualisiert",
    es: "Actualizadas {ok} de {total} fuentes",
  },
  /** `{added}` of `{total}` OPML entries imported. */
  importedFeeds: {
    default: "Imported {added} of {total} feeds", "zh-Hans": "导入了 {total} 个订阅中的 {added} 个",
    "zh-Hant": "匯入了 {total} 個訂閱中的 {added} 個",
    ja: "{total}件中{added}件のフィードをインポートしました",
    ru: "Импортировано {added} из {total} лент", fr: "{added} flux importés sur {total}",
    de: "{added} von {total} Feeds importiert", es: "Importadas {added} de {total} fuentes",
  },
  invalidUrl: {
    default: "Enter a valid http(s) feed URL", "zh-Hans": "请输入有效的 http(s) 订阅地址",
    "zh-Hant": "請輸入有效的 http(s) 訂閱網址", ja: "有効なhttp(s)のフィードURLを入力してください",
    ru: "Введите корректный http(s)-адрес ленты", fr: "Saisissez une URL de flux http(s) valide",
    de: "Eine gültige http(s)-Feed-URL eingeben", es: "Introduce una URL http(s) válida",
  },
  alreadySubscribed: {
    default: "Already subscribed", "zh-Hans": "已经订阅过了", "zh-Hant": "已經訂閱過了",
    ja: "すでに購読しています", ru: "Вы уже подписаны", fr: "Déjà abonné",
    de: "Bereits abonniert", es: "Ya estás suscrito",
  },
  pasteOpml: {
    default: "Paste OPML XML first", "zh-Hans": "请先粘贴 OPML XML", "zh-Hant": "請先貼上 OPML XML",
    ja: "先にOPMLのXMLを貼り付けてください", ru: "Сначала вставьте OPML XML",
    fr: "Collez d'abord le XML OPML", de: "Zuerst OPML-XML einfügen", es: "Pega primero el XML OPML",
  },
  noUrlsInOpml: {
    default: "No feed URLs found in this OPML", "zh-Hans": "这份 OPML 里没有找到订阅地址",
    "zh-Hant": "這份 OPML 裡沒有找到訂閱網址", ja: "このOPMLにフィードURLが見つかりません",
    ru: "В этом OPML не найдено адресов лент", fr: "Aucune URL de flux dans cet OPML",
    de: "Keine Feed-URLs in diesem OPML gefunden", es: "No hay URLs de fuentes en este OPML",
  },
} satisfies Record<string, Localized>;

export type RssStringKey = keyof typeof STRINGS;

export function tr(
  locale: string,
  key: RssStringKey,
  params?: Record<string, string | number>,
): string {
  const bundle: Localized = STRINGS[key];
  const requested = locale.toLowerCase();
  const base = requested.split("-")[0];
  const exact = Object.keys(bundle).find(
    (candidate) => candidate !== "default" && candidate.toLowerCase() === requested,
  );
  const match =
    exact ??
    Object.keys(bundle).find(
      (candidate) => candidate !== "default" && candidate.toLowerCase() === base,
    );
  let text = bundle[match ?? "default"] ?? bundle.default;
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** Article-count tag with the one/many split handled per key. */
export function articlesTag(locale: string, count: number): string {
  return count === 1 ? tr(locale, "articlesTagOne") : tr(locale, "articlesTag", { n: count });
}
