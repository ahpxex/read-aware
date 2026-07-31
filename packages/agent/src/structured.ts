/**
 * 结构化一次性输出：从纯文本补全里抠出 JSON 并对照（子集的）JSON Schema
 * 校验。provider 原生的 structured output 没有走进 pi 的 complete 通道，
 * 所以契约在 prompt 层——指示、解析、校验、失败带错误重试一次。
 * `ask({ schema })`（runtime.ts）与需要结构化答案的插件共用这一层。
 */

/** 从模型输出里抠出 JSON 对象（容忍 ```json 围栏与前后废话）。 */
export function extractJsonObject(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("response contained no JSON object");
  }
  return text.slice(start, end + 1);
}

/**
 * 校验一个值是否符合 schema，返回人类可读的违例清单（空数组 = 通过）。
 *
 * 有意只实现 JSON Schema 的一个子集——`type`（含 integer）、`enum`、
 * `properties` / `required` / `additionalProperties: false`、`items`。
 * 这覆盖了"让模型回填一个结构"的全部真实需求；没实现的关键字被静默
 * 忽略，宁可放过也不误杀。
 */
export function schemaViolations(
  value: unknown,
  schema: Record<string, unknown>,
  path = "$",
): string[] {
  const problems: string[] = [];
  const kindOf = (v: unknown): string =>
    v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

  const type = schema.type;
  if (typeof type === "string") {
    const actual = kindOf(value);
    const ok =
      type === "integer" ? actual === "number" && Number.isInteger(value) : actual === type;
    if (!ok) {
      problems.push(`${path}: expected ${type}, got ${actual}`);
      return problems;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => entry === value)) {
    problems.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (!(key in (value as Record<string, unknown>))) {
        problems.push(`${path}.${key}: required property is missing`);
      }
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const propSchema = properties[key];
      if (propSchema) {
        problems.push(...schemaViolations(entry, propSchema, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        problems.push(`${path}.${key}: unexpected property`);
      }
    }
  }

  if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
    value.forEach((entry, index) => {
      problems.push(
        ...schemaViolations(entry, schema.items as Record<string, unknown>, `${path}[${index}]`),
      );
    });
  }

  return problems;
}
