import type { PluginBook, PluginCollection, PluginContext, PluginDetailView, PluginFormView, PluginListView } from "@read-aware/plugin-types";
import { organizeStrings } from "./organize-strings";
import { mutationDone } from "./organize-books";

function nameForm(ctx: PluginContext, collection?: PluginCollection): PluginFormView {
  const t = organizeStrings(ctx.locale), commands = ctx.domains.library!.commands!.collections;
  return { kind: "form", title: collection ? t.rename : t.create,
    fields: [{ kind: "text", id: "name", label: t.name, value: collection?.name ?? "" }], submitLabel: t.save,
    onSubmit: async values => {
      const name = typeof values.name === "string" ? values.name.trim() : "";
      if (!name) return { fieldErrors: { name: t.required } };
      if (collection) await commands.rename(collection.id, name);
      else await commands.create(name);
      return mutationDone(ctx, () => collectionList(ctx));
    },
  };
}

export async function collectionList(ctx: PluginContext): Promise<PluginListView> {
  const t = organizeStrings(ctx.locale), collections = await ctx.domains.library!.queries.collections.list();
  return { kind: "list", title: t.collections, searchable: true,
    items: collections.map(collection => ({ id: collection.id, title: collection.name, icon: "folder",
      onSelect: async () => ({ view: await collectionDetail(ctx, collection) }),
    })), actions: [{ id: "create", label: t.create, icon: "plus", run: () => ({ view: nameForm(ctx) }) },
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await collectionList(ctx), navigation: "replace" }) }],
  };
}

async function collectionDetail(ctx: PluginContext, collection: PluginCollection): Promise<PluginDetailView> {
  const t = organizeStrings(ctx.locale), library = ctx.domains.library!;
  const members = await library.queries.collections.booksIn(collection.id);
  return { kind: "detail", title: collection.name, content: [{ kind: "metric", label: t.selected, value: String(members.length) }],
    actions: [
      { id: "rename", label: t.rename, icon: "note-pencil", run: () => ({ view: nameForm(ctx, collection) }) },
      { id: "remove", label: t.remove, icon: "trash", variant: "danger", run: () => ({ view: {
        kind: "form", title: collection.name, fields: [{ kind: "checkbox", id: "confirm", label: t.deleteWarning, value: false }],
        submitLabel: t.remove, onSubmit: async values => {
          if (values.confirm !== true) return { fieldErrors: { confirm: t.confirmRequired } };
          await library.commands!.collections.remove(collection.id);
          return mutationDone(ctx, () => collectionList(ctx));
        },
      } }) },
    ],
  };
}

export async function moveBooks(ctx: PluginContext, selected: PluginBook[]): Promise<PluginDetailView> {
  const t = organizeStrings(ctx.locale), library = ctx.domains.library!;
  const books = selected.map(book => ({ id: book.id, title: book.title })), bookIds = books.map(book => book.id);
  const collections = await library.queries.collections.list();
  // Choice tokens never collide with an opaque collection ID, including an empty-looking one.
  const targets = [null, ...collections.map(collection => collection.id)];
  const form = (): PluginFormView => ({ kind: "form", fields: [
    { kind: "select", id: "destination", label: t.destination, value: "", options: [
      { value: "", label: t.destination }, { value: "0", label: t.ungroup }, ...collections.map((collection, index) => ({ value: String(index + 1), label: collection.name })),
    ] },
    { kind: "checkbox", id: "confirm", label: `${t.selected}: ${bookIds.length}`, value: false },
  ], submitLabel: t.move, onSubmit: async values => {
    if (values.confirm !== true) return { fieldErrors: { confirm: t.confirmRequired } };
    const index = targets.findIndex((_, index) => String(index) === values.destination);
    if (index < 0) return { fieldErrors: { destination: t.required } };
    const target = targets[index];
    if (target !== null && !(await library.queries.collections.list()).some(collection => collection.id === target)) {
      return { fieldErrors: { destination: t.noCollection } };
    }
    await library.commands!.collections.assignBooks([...bookIds], target);
    return mutationDone(ctx, () => collectionList(ctx));
  } });
  const render = (offset: number): PluginDetailView => ({ kind: "detail", title: `${t.move} (${bookIds.length})`, content: [
    { kind: "list", items: books.slice(offset, offset + 20).map(book => ({ id: book.id, title: book.title, subtitle: book.id, icon: "book-open" })),
      pagination: { page: Math.floor(offset / 20) + 1, pageCount: Math.max(1, Math.ceil(bookIds.length / 20)),
        ...(offset > 0 ? { onPrevious: () => ({ view: render(offset - 20), navigation: "replace" as const }) } : {}),
        ...(offset + 20 < books.length ? { onNext: () => ({ view: render(offset + 20), navigation: "replace" as const }) } : {}),
      },
    }, form(),
  ] });
  return render(0);
}
