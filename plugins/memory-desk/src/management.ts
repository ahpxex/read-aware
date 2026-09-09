import type { MemoryMutation, PluginContext, PluginDetailView, PluginView } from "@read-aware/plugin-types";
import { liveMemoryView, type MemoryDeskView } from "./live-memory";

const words: Record<string, readonly string[]> = {
  en: ["Memory", "Refresh", "Correct", "Pin", "Unpin", "Forget", "Content", "Confirm forgetting this memory", "Required", "Scope"],
  "zh-Hans": ["记忆", "刷新", "纠正", "置顶", "取消置顶", "遗忘", "内容", "确认遗忘这条记忆", "必填", "范围"],
  "zh-Hant": ["記憶", "重新整理", "更正", "置頂", "取消置頂", "遺忘", "內容", "確認遺忘這條記憶", "必填", "範圍"],
  ja: ["記憶", "更新", "修正", "固定", "固定解除", "忘却", "内容", "この記憶を忘れることを確認", "必須", "範囲"],
  de: ["Erinnerung", "Aktualisieren", "Korrigieren", "Anheften", "Lösen", "Vergessen", "Inhalt", "Vergessen dieser Erinnerung bestätigen", "Erforderlich", "Bereich"],
  fr: ["Souvenir", "Actualiser", "Corriger", "Épingler", "Désépingler", "Oublier", "Contenu", "Confirmer l'oubli de ce souvenir", "Obligatoire", "Portée"],
  es: ["Recuerdo", "Actualizar", "Corregir", "Fijar", "Desfijar", "Olvidar", "Contenido", "Confirmar que se olvide este recuerdo", "Obligatorio", "Alcance"],
  ru: ["Память", "Обновить", "Исправить", "Закрепить", "Открепить", "Забыть", "Содержание", "Подтвердить забывание этой записи", "Обязательно", "Область"],
};
export async function memoryDetail(ctx: PluginContext, id: string, removed: () => Promise<PluginView>): Promise<MemoryDeskView> {
  const t = words[ctx.locale] ?? words[ctx.locale.split("-")[0]] ?? words.en!;
  return liveMemoryView(ctx, { kind: "inspect", memoryId: id }, t[0]!, result => {
  if (result.kind !== "inspect") throw Error("Unexpected memory observation result");
  const snapshot = result.snapshot;
  if (!snapshot) return { kind: "detail", title: t[0]!, content: [{ kind: "error", code: "memory/not-found" }] };
  const { memory, revision } = snapshot;
  const refresh = () => memoryDetail(ctx, id, removed);
  const apply = (change: MemoryMutation) => ctx.domains.memory!.commands!.mutate(change);
  const base = { memoryId: id, expectedRevision: revision };
  return { kind: "detail", title: t[0]!, content: [
    { kind: "text", text: memory.content }, { kind: "keyValue", rows: [{ label: "ID", value: id }, { label: t[9]!, value: memory.scope }] },
  ], actions: [
    { id: "refresh", label: t[1]!, icon: "arrows-clockwise", run: async () => ({ view: await refresh(), navigation: "replace" }) },
    ...(ctx.domains.memory!.commands ? [
      { id: "pin", label: t[memory.pinned ? 4 : 3]!, icon: "push-pin", run: async () => {
        await apply({ ...base, op: "setPinned", pinned: !memory.pinned }); return { view: await refresh(), navigation: "replace" as const };
      } },
      { id: "correct", label: t[2]!, icon: "pencil-simple", run: () => ({ view: { kind: "form" as const, title: t[2]!, fields: [
        { id: "content", kind: "textarea" as const, label: t[6]!, value: memory.content },
      ], onSubmit: async (values: Record<string, unknown>) => {
        const content = values.content;
        if (typeof content !== "string" || !content.trim() || content.length > 16000) return { fieldErrors: { content: t[8]! } };
        await apply({ ...base, op: "correct", content }); return { view: await refresh(), navigation: "replace" as const };
      } } }) },
      { id: "forget", label: t[5]!, icon: "trash", run: () => ({ view: { kind: "form" as const, title: t[5]!, fields: [
        { id: "content", kind: "textarea" as const, label: t[6]!, value: memory.content, disabled: true },
        { id: "confirm", kind: "checkbox" as const, label: t[7]!, value: false },
      ], onSubmit: async (values: Record<string, unknown>) => {
        if (values.confirm !== true) return { fieldErrors: { confirm: t[8]! } };
        await apply({ ...base, op: "forget" }); return { view: await removed(), navigation: "replace" as const };
      } } }) },
    ] : []),
  ] } satisfies PluginDetailView;
  });
}
