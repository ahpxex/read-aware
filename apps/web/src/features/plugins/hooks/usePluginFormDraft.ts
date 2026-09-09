import { createContext, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useReactiveSetting } from "../../../hooks/useReactiveSetting";
import type { PluginFormValues, PluginFormView } from "../lib/plugin-types";
import { PluginFormDraft, type PluginFormDrafts } from "../lib/plugin-form-drafts";
import type { PluginResultRunner } from "../components/plugin-view-types";

export const PluginFormDraftContext = createContext<PluginFormDrafts | null>(null);

export function usePluginFormDraft(view: PluginFormView, onResult: PluginResultRunner) {
  const owner = useContext(PluginFormDraftContext);
  const [local] = useState(() => owner ? null : new PluginFormDraft(view.fields));
  const draft = owner ? owner.get(view) : local;
  if (!draft) throw Error("Plugin form is not owned by its navigation frame");
  const values = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const [validation, setValidation] = useState<{ values: PluginFormValues; errors: Record<string, string> } | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const reactive = view.submitMode === "change";
  useLayoutEffect(() => { if (!owner) local?.reconcile(view.fields); }, [owner, local, view]);
  useEffect(() => {
    setValidation(current => {
      if (!current) return current;
      const remaining = Object.entries(current.errors).filter(([id]) =>
        view.fields.some(field => field.id === id && (field.kind === "secret"
          || (Object.hasOwn(values, id) && Object.is(values[id], current.values[id])))));
      return remaining.length === Object.keys(current.errors).length ? current
        : { values: current.values, errors: Object.fromEntries(remaining) };
    });
  }, [values, view.fields]);
  const errors = Object.fromEntries(Object.entries(validation?.errors ?? {}).filter(([id]) =>
    view.fields.some(field => field.id === id && (field.kind === "secret"
      || (Object.hasOwn(values, id) && Object.is(values[id], validation?.values[id]))))));
  const { flush } = useReactiveSetting({ value: values, revision: saveRevision, enabled: reactive,
    persist: next => {
      setValidation(null);
      void onResult(() => view.onSubmit({ ...next }), { background: true }).then(result => {
        if (result?.fieldErrors && draft.getSnapshot() === next) setValidation({ values: next, errors: result.fieldErrors });
      });
    },
  });
  const updateValue = (id: string, value: string | boolean | number) => {
    draft.update(id, value);
    setValidation(current => {
      if (!current || !Object.hasOwn(current.errors, id)) return current;
      const errors = { ...current.errors }; delete errors[id];
      return { ...current, errors };
    });
    if (reactive) setSaveRevision(revision => revision + 1);
  };
  const submit = () => {
    if (reactive) { flush(); return; }
    setValidation(null);
    const next = draft.getSnapshot();
    void onResult(() => view.onSubmit({ ...next })).then(result => {
      if (result?.fieldErrors && draft.getSnapshot() === next) setValidation({ values: next, errors: result.fieldErrors });
    });
  };
  return { values, errors, updateValue, submit, flush, reactive };
}
