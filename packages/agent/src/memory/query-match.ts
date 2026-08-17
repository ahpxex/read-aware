/**
 * 记忆检索的查询匹配（fixture 与产品 MemoryPort 的共享实现）。
 * 朴素整串 includes 对多词查询必然失配（"programming example-language
 * preference" 永远不是任何记忆内容的子串）——按词元放宽：任一有区分度
 * 的词元命中即算匹配，大小写不敏感；CJK 查询不分词、整串与词元并试。
 */
const MIN_TOKEN_CHARS = 4;
/** CJK 词元短也有区分度（"窗户"两字足矣）。 */
const MIN_CJK_TOKEN_CHARS = 2;

function tokenize(query: string): string[] {
  return query
    .split(/[\s,.。，！？!?；;：:、"'“”‘’()（）《》〈〉【】\[\]\-—…·/|]+/)
    .map((token) => token.trim())
    .filter((token) => {
      if (!token) return false;
      const min = /[一-鿿぀-ヿ가-힯]/.test(token) ? MIN_CJK_TOKEN_CHARS : MIN_TOKEN_CHARS;
      return token.length >= min;
    });
}

/** content 是否命中 query：整串子串，或任一有区分度词元子串（不区分大小写）。 */
export function matchesMemoryQuery(content: string, query: string): boolean {
  const haystack = content.toLowerCase();
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  if (haystack.includes(trimmed)) return true;
  return tokenize(trimmed).some((token) => haystack.includes(token));
}
