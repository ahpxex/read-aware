/** 工具返回值的统一构造：模型只看 JSON 文本。 */
export function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: undefined,
  };
}
