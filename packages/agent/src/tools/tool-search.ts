/**
 * Keyword search over tool metadata for capability discovery.
 *
 * A model describes what it needs in a few English words. Words that occur in
 * most tools ("book", "get", "file") say little, a word in the tool's name says
 * more than the same word deep in its description, and a long description must
 * not win by mentioning everything. So terms are weighted by rarity (IDF), the
 * name, label and declared keywords count more than body text, and body text is
 * length-normalised (BM25).
 */
export interface ToolSearchDocument {
  name: string;
  label: string;
  /** Full description plus the schema's own wording (property names, enum values, nested descriptions). */
  body: string;
  /** Words a reader would use that the tool's own text does not contain. */
  keywords?: readonly string[];
}

export interface ToolSearchHit<T> {
  item: T;
  score: number;
}

const STOPWORDS = new Set(
  "a an and any are as at be by can do does for from how i in into is it me my no not of on or that the this to tool tools use using want what with".split(
    " ",
  ),
);

/**
 * The forms a word may share with its inflections: "deleted" and "deleting"
 * both offer "delete", "starred" offers "star", "stats" offers "stat". Offering
 * candidates instead of cutting every word to one stem keeps unrelated words
 * apart ("state" never becomes "stat").
 */
export function wordForms(word: string): string[] {
  const forms = new Set([word]);
  if (word.length > 4 && word.endsWith("ies")) forms.add(`${word.slice(0, -3)}y`);
  else if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) forms.add(word.slice(0, -1));
  const base =
    word.length > 5 && word.endsWith("ing")
      ? word.slice(0, -3)
      : word.length > 4 && word.endsWith("ed")
        ? word.slice(0, -2)
        : undefined;
  if (base) {
    forms.add(base);
    forms.add(`${base}e`);
    // "starred" -> "starr" -> "star"
    if (/([^aeiou])\1$/.test(base)) forms.add(base.slice(0, -1));
  }
  return [...forms];
}

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

const NAME_WEIGHT = 3;
const KEYWORD_WEIGHT = 3;
const LABEL_WEIGHT = 2;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Rank `items` for `query`, best first; items sharing no term with the query are left out. */
export function searchTools<T>(
  items: readonly T[],
  document: (item: T) => ToolSearchDocument,
  query: string,
): ToolSearchHit<T>[] {
  const terms = [...new Set(tokenize(query))].map(wordForms);
  if (!terms.length) return [];
  const formsOf = (text: string) => new Set(tokenize(text).flatMap(wordForms));
  const indexed = items.map((item) => {
    const doc = document(item);
    const body = new Map<string, number>();
    const bodyTokens = tokenize(doc.body);
    for (const token of bodyTokens) for (const form of wordForms(token)) body.set(form, (body.get(form) ?? 0) + 1);
    return {
      item,
      sortName: doc.name,
      name: formsOf(doc.name),
      label: formsOf(doc.label),
      keywords: formsOf((doc.keywords ?? []).join(" ")),
      body,
      bodyLength: bodyTokens.length,
    };
  });
  type Indexed = (typeof indexed)[number];
  const inField = (field: Set<string>, forms: string[]) => forms.some((form) => field.has(form));
  const inBody = (entry: Indexed, forms: string[]) => Math.max(0, ...forms.map((form) => entry.body.get(form) ?? 0));
  const averageBody = indexed.reduce((sum, entry) => sum + entry.bodyLength, 0) / Math.max(indexed.length, 1) || 1;
  const idf = terms.map((forms) => {
    const containing = indexed.filter(
      (entry) =>
        inField(entry.name, forms) ||
        inField(entry.label, forms) ||
        inField(entry.keywords, forms) ||
        inBody(entry, forms) > 0,
    ).length;
    return Math.log(1 + indexed.length / Math.max(containing, 1));
  });
  const hits: Array<ToolSearchHit<T> & { sortName: string }> = [];
  for (const entry of indexed) {
    let score = 0;
    terms.forEach((forms, term) => {
      const frequency = inBody(entry, forms);
      const bodyScore = frequency
        ? (frequency * (BM25_K1 + 1)) / (frequency + BM25_K1 * (1 - BM25_B + (BM25_B * entry.bodyLength) / averageBody))
        : 0;
      const fields =
        (inField(entry.name, forms) ? NAME_WEIGHT : 0) +
        (inField(entry.keywords, forms) ? KEYWORD_WEIGHT : 0) +
        (inField(entry.label, forms) ? LABEL_WEIGHT : 0) +
        bodyScore;
      score += idf[term]! * fields;
    });
    if (score > 0) hits.push({ item: entry.item, score, sortName: entry.sortName });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.sortName.localeCompare(b.sortName, "en"))
    .map(({ item, score }) => ({ item, score }));
}

/** Property names, enum/const values and nested descriptions: the words a schema itself uses. */
export function schemaWording(schema: unknown, out: string[] = []): string {
  if (Array.isArray(schema)) for (const item of schema) schemaWording(item, out);
  else if (schema && typeof schema === "object")
    for (const [key, value] of Object.entries(schema)) {
      if (key === "properties" && value && typeof value === "object") {
        for (const [property, child] of Object.entries(value)) {
          out.push(property);
          schemaWording(child, out);
        }
      } else if ((key === "description" || key === "const") && typeof value === "string") out.push(value);
      else if (key === "enum" && Array.isArray(value)) out.push(...value.filter((item) => typeof item === "string"));
      else schemaWording(value, out);
    }
  return out.join(" ");
}
