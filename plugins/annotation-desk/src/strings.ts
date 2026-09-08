const locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"] as const;
type Translations = readonly [string, string, string, string, string, string, string, string];
const strings = {
  title: ["Annotation Desk", "标注整理器", "標註整理器", "注釈デスク", "Аннотации", "Annotations", "Anmerkungen", "Anotaciones"],
  book: ["Book", "书籍", "書籍", "本", "Книга", "Livre", "Buch", "Libro"],
  allBooks: ["All books", "全部书籍", "全部書籍", "すべての本", "Все книги", "Tous les livres", "Alle Bücher", "Todos los libros"],
  kind: ["Type", "类型", "類型", "種類", "Тип", "Type", "Typ", "Tipo"],
  all: ["All types", "全部类型", "全部類型", "すべての種類", "Все типы", "Tous les types", "Alle Typen", "Todos los tipos"],
  note: ["Note", "笔记", "筆記", "ノート", "Заметка", "Note", "Notiz", "Nota"],
  highlight: ["Highlight", "高亮", "螢光標記", "ハイライト", "Выделение", "Surlignage", "Markierung", "Resaltado"],
  ask: ["Question", "提问", "提問", "質問", "Вопрос", "Question", "Frage", "Pregunta"],
  query: ["Search text", "搜索文字", "搜尋文字", "検索語", "Поиск текста", "Rechercher du texte", "Text suchen", "Buscar texto"],
  filter: ["Apply filters", "筛选", "篩選", "絞り込む", "Применить фильтры", "Filtrer", "Filtern", "Filtrar"],
  invalidQuery: ["Use at most 500 characters.", "最多输入 500 个字符。", "最多輸入 500 個字元。", "500 文字以内で入力してください。", "Не более 500 символов.", "500 caractères maximum.", "Maximal 500 Zeichen.", "Máximo 500 caracteres."],
  invalid: ["Choose a valid option.", "请选择有效选项。", "請選擇有效選項。", "有効な項目を選択してください。", "Выберите допустимый вариант.", "Choisissez une option valide.", "Bitte gültige Option wählen.", "Elige una opción válida."],
  empty: ["No annotations", "暂无标注", "暫無標註", "注釈はありません", "Аннотаций нет", "Aucune annotation", "Keine Anmerkungen", "No hay anotaciones"],
  missing: ["Annotation no longer exists.", "这条标注已不存在。", "這則標註已不存在。", "この注釈は削除されました。", "Аннотация больше не существует.", "Cette annotation n’existe plus.", "Diese Anmerkung existiert nicht mehr.", "Esta anotación ya no existe."],
  missingBook: ["Unavailable book", "书籍不可用", "書籍無法使用", "利用できない本", "Книга недоступна", "Livre indisponible", "Buch nicht verfügbar", "Libro no disponible"],
  refresh: ["Refresh", "刷新", "重新整理", "更新", "Обновить", "Actualiser", "Aktualisieren", "Actualizar"],
  previous: ["Previous page", "上一页", "上一頁", "前のページ", "Предыдущая страница", "Page précédente", "Vorherige Seite", "Página anterior"],
  next: ["Next page", "下一页", "下一頁", "次のページ", "Следующая страница", "Page suivante", "Nächste Seite", "Página siguiente"],
  select: ["Select annotations", "选择标注", "選擇標註", "注釈を選択", "Выбрать аннотации", "Sélectionner les annotations", "Anmerkungen auswählen", "Seleccionar anotaciones"],
  review: ["Review selection", "检查所选项", "檢查所選項", "選択を確認", "Проверить выбор", "Vérifier la sélection", "Auswahl prüfen", "Revisar selección"],
  choose: ["Select at least one annotation.", "请至少选择一条标注。", "請至少選擇一則標註。", "注釈を選択してください。", "Выберите хотя бы одну аннотацию.", "Sélectionnez au moins une annotation.", "Mindestens eine Anmerkung auswählen.", "Selecciona al menos una anotación."],
  pageJson: ["Export this page (JSON)", "导出本页（JSON）", "匯出本頁（JSON）", "このページを出力（JSON）", "Экспорт страницы (JSON)", "Exporter cette page (JSON)", "Diese Seite exportieren (JSON)", "Exportar esta página (JSON)"],
  pageCsv: ["Export this page (CSV)", "导出本页（CSV）", "匯出本頁（CSV）", "このページを出力（CSV）", "Экспорт страницы (CSV)", "Exporter cette page (CSV)", "Diese Seite exportieren (CSV)", "Exportar esta página (CSV)"],
  json: ["Export selection (JSON)", "导出所选项（JSON）", "匯出所選項（JSON）", "選択項目を出力（JSON）", "Экспорт выбранного (JSON)", "Exporter la sélection (JSON)", "Auswahl exportieren (JSON)", "Exportar selección (JSON)"],
  csv: ["Export selection (CSV)", "导出所选项（CSV）", "匯出所選項（CSV）", "選択項目を出力（CSV）", "Экспорт выбранного (CSV)", "Exporter la sélection (CSV)", "Auswahl exportieren (CSV)", "Exportar selección (CSV)"],
  exported: ["Export saved", "导出已保存", "匯出已儲存", "保存しました", "Экспорт сохранён", "Export enregistré", "Export gespeichert", "Exportación guardada"],
  open: ["Open in reader", "在阅读器中打开", "在閱讀器中開啟", "リーダーで開く", "Открыть в читалке", "Ouvrir dans le lecteur", "Im Reader öffnen", "Abrir en el lector"],
  save: ["Save", "保存", "儲存", "保存", "Сохранить", "Enregistrer", "Speichern", "Guardar"],
  saved: ["Changes saved", "修改已保存", "修改已儲存", "変更を保存しました", "Изменения сохранены", "Modifications enregistrées", "Änderungen gespeichert", "Cambios guardados"],
  refreshFailed: ["Changes were saved, but annotations could not be reloaded.", "修改已保存，但无法重新读取标注。", "修改已儲存，但無法重新讀取標註。", "変更は保存されましたが、注釈を再読み込みできませんでした。", "Изменения сохранены, но аннотации не удалось загрузить.", "Les modifications sont enregistrées, mais les annotations n’ont pas pu être rechargées.", "Änderungen gespeichert, aber Anmerkungen konnten nicht neu geladen werden.", "Los cambios se guardaron, pero no se pudieron recargar las anotaciones."],
  body: ["Note text", "笔记内容", "筆記內容", "ノート本文", "Текст заметки", "Texte de la note", "Notiztext", "Texto de la nota"],
  bodyLimit: ["Use at most 100,000 characters.", "笔记不能超过 100,000 个字符。", "筆記不能超過 100,000 個字元。", "100,000 文字以内で入力してください。", "Не более 100 000 символов.", "100 000 caractères maximum.", "Maximal 100.000 Zeichen.", "Máximo 100.000 caracteres."],
  color: ["Color", "颜色", "顏色", "色", "Цвет", "Couleur", "Farbe", "Color"],
  yellow: ["Yellow", "黄色", "黃色", "黄", "Жёлтый", "Jaune", "Gelb", "Amarillo"],
  green: ["Green", "绿色", "綠色", "緑", "Зелёный", "Vert", "Grün", "Verde"],
  blue: ["Blue", "蓝色", "藍色", "青", "Синий", "Bleu", "Blau", "Azul"],
  pink: ["Pink", "粉色", "粉紅色", "ピンク", "Розовый", "Rose", "Rosa", "Rosa"],
  style: ["Style", "样式", "樣式", "スタイル", "Стиль", "Style", "Stil", "Estilo"],
  underline: ["Underline", "下划线", "底線", "下線", "Подчёркивание", "Soulignement", "Unterstreichung", "Subrayado"],
  recolor: ["Apply to selected highlights", "应用到所选高亮", "套用至所選標記", "選択したハイライトに適用", "Применить к выделениям", "Appliquer aux surlignages", "Auf Auswahl anwenden", "Aplicar a los resaltados"],
  remove: ["Delete selected annotations", "删除所选标注", "刪除所選標註", "選択した注釈を削除", "Удалить выбранные аннотации", "Supprimer la sélection", "Auswahl löschen", "Eliminar selección"],
  confirm: ["Confirm deletion of these annotations", "确认删除这些标注", "確認刪除這些標註", "これらの注釈の削除を確認", "Подтвердить удаление этих аннотаций", "Confirmer la suppression de ces annotations", "Löschen dieser Anmerkungen bestätigen", "Confirmar eliminación de estas anotaciones"],
  confirmRequired: ["Confirm deletion first.", "请先确认删除。", "請先確認刪除。", "削除を確認してください。", "Сначала подтвердите удаление.", "Confirmez d’abord la suppression.", "Bitte zuerst das Löschen bestätigen.", "Confirma primero la eliminación."],
  conflict: ["An annotation changed or was removed. Nothing was changed. Refresh before trying again.", "标注已被修改或删除，本次未作更改。请刷新后重新检查。", "標註已被修改或刪除，本次未作變更。請重新整理後檢查。", "注釈が変更または削除されました。変更は保存されていません。更新して確認してください。", "Аннотация изменена или удалена. Ничего не изменено. Обновите и проверьте снова.", "Une annotation a changé ou a été supprimée. Aucune modification. Actualisez avant de réessayer.", "Eine Anmerkung wurde geändert oder gelöscht. Nichts wurde geändert. Bitte aktualisieren.", "Una anotación cambió o se eliminó. No se modificó nada. Actualiza antes de reintentar."],
} satisfies Record<string, Translations>;

export function tr(locale: string, key: keyof typeof strings): string {
  const normalized = locale.toLowerCase();
  let index = locales.findIndex(candidate => candidate.toLowerCase() === normalized);
  if (index < 0) index = normalized.startsWith("zh") ? (/hant|tw|hk|mo/.test(normalized) ? 2 : 1)
    : locales.findIndex(candidate => candidate === normalized.split("-")[0]);
  return strings[key][index < 0 ? 0 : index];
}
