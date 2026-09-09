import type { PluginContext, PluginDetailView, PluginFormView, PluginViewResult } from "@read-aware/plugin-types";
import { liveMemoryView, type MemoryDeskView } from "./live-memory";

const words: Record<string, readonly string[]> = {
  en: ["Book classification", "Narrative", "Expository", "Unclassified", "Change classification", "Current classification", "I confirm the classification and spoiler-boundary change", "Expository books have no chapter spoiler boundary. Existing digests rebuild gradually; past answers and in-flight work are not undone.", "Required", "Refresh"],
  "zh-Hans": ["书籍分类", "叙事性", "说明性", "未分类", "更改分类", "当前分类", "确认更改分类及剧透边界", "说明性书籍不设章节剧透边界。旧摘要会逐步重建；历史答复和在途任务不会撤销。", "必填", "刷新"],
  "zh-Hant": ["書籍分類", "敘事性", "說明性", "未分類", "變更分類", "目前分類", "確認變更分類及劇透邊界", "說明性書籍不設章節劇透邊界。舊摘要會逐步重建；歷史回覆和進行中的工作不會撤銷。", "必填", "重新整理"],
  ja: ["本の分類", "物語", "解説文", "未分類", "分類を変更", "現在の分類", "分類とネタバレ境界の変更を確認", "解説文には章のネタバレ境界がありません。既存の要約は順次再生成され、過去の回答や進行中の処理は取り消されません。", "必須", "更新"],
  de: ["Buchklassifizierung", "Erzählung", "Sachtext", "Nicht klassifiziert", "Klassifizierung ändern", "Aktuelle Klassifizierung", "Änderung der Klassifizierung und Spoilergrenze bestätigen", "Sachtexte haben keine kapitelbezogene Spoilergrenze. Zusammenfassungen werden schrittweise erneuert; frühere Antworten und laufende Vorgänge bleiben bestehen.", "Erforderlich", "Aktualisieren"],
  fr: ["Classification du livre", "Narratif", "Explicatif", "Non classé", "Modifier la classification", "Classification actuelle", "Confirmer la classification et la limite de divulgation", "Les livres explicatifs n'ont pas de limite de divulgation par chapitre. Les résumés sont renouvelés progressivement ; les réponses passées et les opérations en cours ne sont pas annulées.", "Obligatoire", "Actualiser"],
  es: ["Clasificación del libro", "Narrativo", "Expositivo", "Sin clasificar", "Cambiar clasificación", "Clasificación actual", "Confirmar la clasificación y el límite de spoilers", "Los libros expositivos no tienen límite de spoilers por capítulo. Los resúmenes se renuevan gradualmente; las respuestas anteriores y las tareas en curso no se deshacen.", "Obligatorio", "Actualizar"],
  ru: ["Классификация книги", "Повествование", "Изложение", "Не определена", "Изменить классификацию", "Текущая классификация", "Подтверждаю изменение классификации и границы спойлеров", "Изложение не ограничивает спойлеры по главам. Резюме обновляются постепенно; прошлые ответы и текущие операции не отменяются.", "Обязательно", "Обновить"],
};
export const classificationWords = (locale: string) => words[locale] ?? words[locale.split("-")[0]] ?? words.en!;

export async function classificationView(ctx: PluginContext, bookId: string): Promise<MemoryDeskView> {
  const t = classificationWords(ctx.locale), refresh = () => classificationView(ctx, bookId);
  return liveMemoryView(ctx, { kind: "classification", bookId }, t[0]!, result => {
    if (result.kind !== "classification") throw Error("Unexpected classification observation");
    const snapshot = result.snapshot;
    if (!snapshot) return { kind: "detail", title: t[0]!, content: [{ kind: "error", code: "reader/book-not-found" }] };
    const { revision, narrativity } = snapshot;
    return { kind: "detail", title: t[0]!, content: [{ kind: "keyValue", rows: [
      { label: "ID", value: bookId }, { label: t[5]!, value: t[snapshot.narrativity === "narrative" ? 1 : snapshot.narrativity === "expository" ? 2 : 3]! },
    ] }], actions: [
      { id: "refresh", label: t[9]!, icon: "arrows-clockwise", run: async () => ({ view: await refresh(), navigation: "replace" }) },
      ...(ctx.domains.memory!.commands ? [{ id: "classify", label: t[4]!, icon: "pencil-simple", run: () => ({ view: {
        kind: "form", title: t[4]!, submitLabel: t[4]!, fields: [
          { id: "narrativity", kind: "select", label: t[0]!, value: narrativity ?? "narrative", options: [{ value: "narrative", label: t[1]! }, { value: "expository", label: t[2]! }] },
          { id: "confirm", kind: "checkbox", label: t[6]!, description: t[7]!, value: false },
        ], onSubmit: async (values): Promise<PluginViewResult> => {
          if (values.narrativity !== "narrative" && values.narrativity !== "expository") return { fieldErrors: { narrativity: t[8]! } };
          if (values.confirm !== true) return { fieldErrors: { confirm: t[8]! } };
          await ctx.domains.memory!.commands!.classify({ bookId, narrativity: values.narrativity, expectedRevision: revision });
          return { view: await refresh(), navigation: "replace" as const };
        },
      } satisfies PluginFormView }) }] : []),
    ] } satisfies PluginDetailView;
  });
}
