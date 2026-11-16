/**
 * What the reader is told when an answer about an unfinished narrative book
 * cannot be published: the answer check found material past the reading
 * boundary (or text this edition does not hold) and no safe rewrite stood.
 * One function, in the reader's language, so that anything asking "was this
 * answer withheld?" compares with the same words the runtime sent.
 */
export function narrativeFallbackAnswer(readerText: string): string {
  if (/[぀-ヿ]/u.test(readerText)) {
    return "今の読書位置を守るため、この先の内容には触れません。どこまで読んだか、またはネタバレ可だと明示してください。";
  }
  if (/[가-힯]/u.test(readerText)) {
    return "현재 읽는 위치를 지키기 위해 이후 내용은 설명하지 않겠습니다. 어디까지 읽었는지 알려 주거나 스포일러를 허용한다고 명확히 말해 주세요.";
  }
  if (/[一-鿿]/u.test(readerText)) {
    return "为了守住你当前的阅读进度，我先不展开这部分。请告诉我读到哪里，或者明确说明可以剧透。";
  }
  if (/[Ѐ-ӿ]/u.test(readerText)) {
    return "Чтобы не раскрывать непрочитанное, я пока не буду развивать эту часть. Скажите, где вы остановились, или явно разрешите спойлеры.";
  }
  return "To protect your current reading position, I will not expand on that yet. Tell me where you are, or explicitly allow spoilers.";
}
