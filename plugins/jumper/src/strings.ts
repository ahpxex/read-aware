const locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"] as const;
const strings = {
  searchQuery: ["Search", "搜索", "搜尋", "検索", "Поиск", "Recherche", "Suche", "Búsqueda"],
  invalidSearch: ["Search is too long or contains control characters.", "搜索内容过长或含控制字符。", "搜尋內容過長或含控制字元。", "検索文字列が長すぎるか、制御文字が含まれています。", "Запрос слишком длинный или содержит управляющие символы.", "La recherche est trop longue ou contient des caractères de contrôle.", "Die Suche ist zu lang oder enthält Steuerzeichen.", "La búsqueda es demasiado larga o contiene caracteres de control."],
  clearSearch: ["Clear search", "清除搜索", "清除搜尋", "検索をクリア", "Очистить поиск", "Effacer la recherche", "Suche löschen", "Borrar búsqueda"],
  searching: ["Searching", "搜索中", "搜尋中", "検索中", "Поиск", "Recherche en cours", "Suche läuft", "Buscando"],
  cancel: ["Cancel", "取消", "取消", "キャンセル", "Отмена", "Annuler", "Abbrechen", "Cancelar"],
  cancelled: ["Search cancelled.", "搜索已取消。", "搜尋已取消。", "検索をキャンセルしました。", "Поиск отменён.", "Recherche annulée.", "Suche abgebrochen.", "Búsqueda cancelada."],
  mode: ["Search in", "查找范围", "查找範圍", "検索対象", "Искать в", "Rechercher dans", "Suchen in", "Buscar en"],
  chapter: ["Chapter", "章节", "章節", "章", "Глава", "Chapitre", "Kapitel", "Capítulo"],
  ordinal: ["TOC order", "目录序号", "目錄序號", "目次の順番", "Порядок оглавления", "Ordre du sommaire", "Inhaltsreihenfolge", "Orden del índice"],
  text: ["Book text", "正文", "正文", "本文", "Текст книги", "Texte du livre", "Buchtext", "Texto del libro"],
  query: ["Number, title, or text", "章节号、标题或文字", "章節號、標題或文字", "番号・見出し・文字列", "Номер, заголовок или текст", "Numéro, titre ou texte", "Nummer, Titel oder Text", "Número, título o texto"],
  search: ["Find", "查找", "查找", "検索", "Найти", "Rechercher", "Suchen", "Buscar"],
  back: ["Go back", "后退", "後退", "戻る", "Назад", "Reculer", "Zurück", "Atrás"],
  forward: ["Go forward", "前进", "前進", "進む", "Вперёд", "Avancer", "Vorwärts", "Adelante"],
  matchCase: ["Match case", "区分大小写", "區分大小寫", "大文字と小文字を区別", "Учитывать регистр", "Respecter la casse", "Groß-/Kleinschreibung", "Distinguir mayúsculas"],
  wholeWords: ["Whole words", "全词匹配", "全詞匹配", "単語全体", "Слова целиком", "Mots entiers", "Ganze Wörter", "Palabras completas"],
  invalid: ["Enter 1 to 500 characters.", "请输入 1 至 500 个字符。", "請輸入 1 至 500 個字元。", "1〜500文字を入力してください。", "Введите от 1 до 500 символов.", "Saisissez de 1 à 500 caractères.", "1 bis 500 Zeichen eingeben.", "Introduce entre 1 y 500 caracteres."],
  missing: ["Chapter not found.", "该章节不存在。", "該章節不存在。", "章が見つかりません。", "Глава не найдена.", "Chapitre introuvable.", "Kapitel nicht gefunden.", "Capítulo no encontrado."],
  unavailable: ["This heading has no reading location.", "此目录标题没有可跳转的位置。", "此目錄標題沒有可跳轉的位置。", "この見出しには移動先がありません。", "У этого заголовка нет позиции для перехода.", "Ce titre n'a pas de destination.", "Diese Überschrift hat kein Sprungziel.", "Este título no tiene destino."],
  noBook: ["No book is open.", "当前没有打开的书籍。", "目前沒有開啟的書籍。", "本が開かれていません。", "Книга не открыта.", "Aucun livre ouvert.", "Kein Buch geöffnet.", "No hay ningún libro abierto."],
  noHits: ["No matches.", "没有匹配结果。", "沒有符合的結果。", "一致する結果はありません。", "Совпадений нет.", "Aucun résultat.", "Keine Treffer.", "Sin coincidencias."],
  more: ["Continue search", "继续搜索", "繼續搜尋", "検索を続ける", "Продолжить поиск", "Continuer la recherche", "Suche fortsetzen", "Continuar búsqueda"],
  pending: ["No matches in this batch.", "本批次没有匹配结果。", "本批次沒有符合的結果。", "この範囲に一致する結果はありません。", "В этой части совпадений нет.", "Aucun résultat dans cette partie.", "Keine Treffer in diesem Abschnitt.", "Sin coincidencias en esta parte."],
  textless: ["This book has no searchable text.", "这本书没有可搜索的文本。", "這本書沒有可搜尋的文字。", "この本には検索可能なテキストがありません。", "В книге нет текста для поиска.", "Ce livre ne contient aucun texte consultable.", "Dieses Buch enthält keinen durchsuchbaren Text.", "Este libro no tiene texto que buscar."],
  unsupported: ["Text search is unavailable for some or all sections.", "部分或全部内容暂不支持文本搜索。", "部分或全部內容暫不支援文字搜尋。", "一部または全部の内容でテキスト検索が利用できません。", "Поиск недоступен для части или всей книги.", "La recherche est indisponible pour tout ou partie du livre.", "Die Textsuche ist für Teile oder das gesamte Buch nicht verfügbar.", "La búsqueda no está disponible en parte o todo el libro."],
} satisfies Record<string, readonly [string, string, string, string, string, string, string, string]>;

export function tr(locale: string, key: keyof typeof strings): string {
  const exact = locales.findIndex(value => value.toLowerCase() === locale.toLowerCase());
  const base = locales.findIndex(value => value === locale.split("-")[0]);
  return strings[key][exact >= 0 ? exact : base >= 0 ? base : 0];
}
