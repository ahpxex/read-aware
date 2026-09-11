const en = {
  title: "Reading Goals", goal: "Reading goal", remember: "Suggest this goal as book memory",
  save: "Save goal", clear: "Clear goal", memory: "Build long-term memory", apply: "Apply",
  noBook: "No book is open.", invalid: "Enter a goal of 1 to 500 characters.", refresh: "Refresh",
};
type Copy = typeof en;
const copies: Record<string, Copy> = {
  en,
  "zh-Hans": { title: "阅读目标", goal: "阅读目标", remember: "将此目标作为本书记忆候选", save: "保存目标", clear: "清除目标", memory: "构建长期记忆", apply: "应用", noBook: "当前没有打开的书籍。", invalid: "请输入 1 至 500 个字符的目标。", refresh: "刷新" },
  "zh-Hant": { title: "閱讀目標", goal: "閱讀目標", remember: "將此目標作為本書記憶候選", save: "儲存目標", clear: "清除目標", memory: "建立長期記憶", apply: "套用", noBook: "目前沒有開啟的書籍。", invalid: "請輸入 1 至 500 個字元的目標。", refresh: "重新整理" },
  ja: { title: "読書目標", goal: "読書目標", remember: "この目標を本のメモリ候補にする", save: "目標を保存", clear: "目標を削除", memory: "長期メモリを作成", apply: "適用", noBook: "本が開かれていません。", invalid: "1〜500文字の目標を入力してください。", refresh: "更新" },
  de: { title: "Leseziele", goal: "Leseziel", remember: "Dieses Ziel als Buchgedächtnis vorschlagen", save: "Ziel speichern", clear: "Ziel löschen", memory: "Langzeitgedächtnis aufbauen", apply: "Anwenden", noBook: "Kein Buch geöffnet.", invalid: "Gib ein Ziel mit 1 bis 500 Zeichen ein.", refresh: "Aktualisieren" },
  fr: { title: "Objectifs de lecture", goal: "Objectif de lecture", remember: "Proposer cet objectif comme mémoire du livre", save: "Enregistrer", clear: "Effacer l'objectif", memory: "Créer une mémoire à long terme", apply: "Appliquer", noBook: "Aucun livre ouvert.", invalid: "Saisissez un objectif de 1 à 500 caractères.", refresh: "Actualiser" },
  es: { title: "Objetivos de lectura", goal: "Objetivo de lectura", remember: "Proponer este objetivo como memoria del libro", save: "Guardar objetivo", clear: "Borrar objetivo", memory: "Crear memoria a largo plazo", apply: "Aplicar", noBook: "No hay ningún libro abierto.", invalid: "Escribe un objetivo de entre 1 y 500 caracteres.", refresh: "Actualizar" },
  ru: { title: "Цели чтения", goal: "Цель чтения", remember: "Предложить цель для памяти книги", save: "Сохранить цель", clear: "Удалить цель", memory: "Создавать долговременную память", apply: "Применить", noBook: "Книга не открыта.", invalid: "Введите цель длиной от 1 до 500 символов.", refresh: "Обновить" },
};
const feedbackEn = { saved: "Goal saved", cleared: "Goal cleared", conflict: "The goal changed. Refresh before trying again.", confirm: "Clear this reading goal", required: "Confirm clearing first." };
const feedback: Record<string, typeof feedbackEn> = {
  en: feedbackEn,
  "zh-Hans": { saved: "目标已保存", cleared: "目标已清除", conflict: "目标已变化，请刷新后再试。", confirm: "清除此阅读目标", required: "请先确认清除。" },
  "zh-Hant": { saved: "目標已儲存", cleared: "目標已清除", conflict: "目標已變更，請重新整理後再試。", confirm: "清除此閱讀目標", required: "請先確認清除。" },
  ja: { saved: "目標を保存しました", cleared: "目標を削除しました", conflict: "目標が変更されました。更新してから再試行してください。", confirm: "この読書目標を削除", required: "削除を確認してください。" },
  de: { saved: "Ziel gespeichert", cleared: "Ziel gelöscht", conflict: "Das Ziel wurde geändert. Bitte zuerst aktualisieren.", confirm: "Dieses Leseziel löschen", required: "Bitte das Löschen bestätigen." },
  fr: { saved: "Objectif enregistré", cleared: "Objectif effacé", conflict: "L'objectif a changé. Actualisez avant de réessayer.", confirm: "Effacer cet objectif de lecture", required: "Confirmez d'abord la suppression." },
  es: { saved: "Objetivo guardado", cleared: "Objetivo borrado", conflict: "El objetivo ha cambiado. Actualiza antes de reintentar.", confirm: "Borrar este objetivo de lectura", required: "Confirma primero el borrado." },
  ru: { saved: "Цель сохранена", cleared: "Цель удалена", conflict: "Цель изменилась. Сначала обновите данные.", confirm: "Удалить эту цель чтения", required: "Сначала подтвердите удаление." },
};
export function copy(locale: string): Copy & typeof feedbackEn {
  return { ...(copies[locale] ?? copies[locale.split("-")[0]!] ?? en), ...(feedback[locale] ?? feedback[locale.split("-")[0]!] ?? feedbackEn) };
}
