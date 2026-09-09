const en = ["Library Desk", "Review selection", "Remove permanently", "This removes the selected books and their source files. This cannot be undone.", "Books removed", "Local files still need cleanup", "Retry file cleanup", "Refresh", "Selected", "Select at most 1000 books", "File cleanup complete", "Books"];
const translations: Record<string, string[]> = {
  en,
  "zh-Hans": ["书库工作台", "核对所选书籍", "永久移除", "将移除所选书籍及其源文件。此操作无法撤销。", "书籍已移除", "本地文件仍待清理", "重试文件清理", "刷新", "已选择", "最多选择 1000 本书", "文件清理完成", "书籍"],
  "zh-Hant": ["書庫工作台", "核對所選書籍", "永久移除", "將移除所選書籍及其來源檔案。此操作無法復原。", "書籍已移除", "本機檔案仍待清理", "重試檔案清理", "重新整理", "已選取", "最多選擇 1000 本書", "檔案清理完成", "書籍"],
  ja: ["書庫デスク", "選択を確認", "完全に削除", "選択した本と元のファイルを削除します。この操作は取り消せません。", "本を削除しました", "ローカルファイルの削除が未完了です", "ファイル削除を再試行", "更新", "選択済み", "最大1000冊まで選択できます", "ファイル削除完了", "本"],
  de: ["Bibliotheksverwaltung", "Auswahl prüfen", "Dauerhaft entfernen", "Die ausgewählten Bücher und Quelldateien werden unwiderruflich entfernt.", "Bücher entfernt", "Lokale Dateien müssen noch bereinigt werden", "Dateibereinigung wiederholen", "Aktualisieren", "Ausgewählt", "Höchstens 1000 Bücher auswählen", "Dateibereinigung abgeschlossen", "Bücher"],
  fr: ["Gestion de bibliothèque", "Vérifier la sélection", "Supprimer définitivement", "Les livres sélectionnés et leurs fichiers sources seront supprimés. Cette action est irréversible.", "Livres supprimés", "Des fichiers locaux restent à supprimer", "Réessayer le nettoyage", "Actualiser", "Sélectionné", "Sélectionnez au maximum 1000 livres", "Nettoyage terminé", "Livres"],
  es: ["Gestión de biblioteca", "Revisar selección", "Eliminar permanentemente", "Los libros seleccionados y sus archivos de origen se eliminarán. Esta acción no se puede deshacer.", "Libros eliminados", "Quedan archivos locales por limpiar", "Reintentar limpieza", "Actualizar", "Seleccionado", "Selecciona un máximo de 1000 libros", "Limpieza completada", "Libros"],
  ru: ["Управление библиотекой", "Проверить выбор", "Удалить навсегда", "Выбранные книги и их исходные файлы будут удалены. Это действие нельзя отменить.", "Книги удалены", "Локальные файлы ещё требуют очистки", "Повторить очистку файлов", "Обновить", "Выбрано", "Выберите не более 1000 книг", "Очистка файлов завершена", "Книги"],
};
export function strings(locale: string) { return translations[locale] ?? translations[locale.split("-")[0]] ?? en; }
