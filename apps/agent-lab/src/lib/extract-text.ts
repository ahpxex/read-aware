/**
 * 正文抽取（doc §11.5 的 lab 版）：foliate 离屏解析 → 按 section 出纯文本。
 * 产品版会在导入时跑同样的事并经 blob registry 落盘；这里抽完直接喂给
 * BookTextPort 的内存实现。章节标题用 TOC 顺序对位（近似，lab 够用）。
 */
import { makeFoliateBook } from "./foliate";

export interface ExtractedChapter {
  title?: string;
  text: string;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export async function extractChapters(file: Blob, name: string): Promise<ExtractedChapter[]> {
  const book = await makeFoliateBook(new File([file], name));
  const tocLabels = (book.toc ?? []).map((item) => item.label?.trim()).filter(Boolean) as string[];
  const chapters: ExtractedChapter[] = [];
  const sections = book.sections ?? [];
  for (const section of sections) {
    if (section.linear === "no" || !section.createDocument) continue;
    try {
      const doc = await section.createDocument();
      const text = normalize(doc.body?.textContent ?? "");
      if (text.length < 40) continue; // 跳过封面/版权页等噪音
      chapters.push({ title: tocLabels[chapters.length], text });
    } catch {
      // 单个 section 解析失败不拖垮整本书
    }
  }
  return chapters;
}
