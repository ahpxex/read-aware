/**
 * 一轮回复内的工具侧状态，thread 每轮 sendTurn 开始时重置/重算：
 * - presentedBookIds：出卡去重（见 present-tools）
 * - spoilerFence：剧透围栏 —— 叙事书且读者未读完时，正文工具只返回读者位置之前的内容；
 *   只有读者在授权卡片上同意（request_spoiler_access）才在本轮放开（见 spoiler-access）。
 */
export interface SpoilerFence {
  /** 可安全返回全文的最后章节；viewport 位于章内时会是当前章 - 1。 */
  throughChapterIndex: number;
  /** 读者所在章节：面向模型的越界错误用它报坐标；配合 readerChapterThrough 划出章内边界。 */
  readerChapterIndex?: number;
  /**
   * 读者所在章节正文里已到达的位置（字符偏移，不含）：视口最后一句的句末。
   * 该章在此之前可读（read_chapter 就地截断），之后与后续章节同属未读。
   * 只有位置被解析成坐标时才有；没有时该章整章不可读。
   */
  readerChapterThrough?: number;
}

/** 本轮可供 read_chapter(around=…) 解析的位置：章内字符区间。 */
export interface TurnReadingRanges {
  position?: import("../runtime/reading-position").ChapterRange;
  selection?: import("../runtime/reading-position").ChapterRange;
}

export interface AgentTurnState {
  /** On-demand schemas, bounded, kept until the thread's agent is discarded. */
  loadedTools?: Set<string>;
  /** Automatic reading context grants captured when this turn began. */
  readingContextPermissions?: import("../runtime/reading-context-policy").ReadingContextPermissions;
  presentedBookIds: Set<string>;
  webImages?: Map<string, import("../web/types").WebImage>;
  presentedWebImages?: Set<string>;
  modelSupportsImages?: boolean;
  modelImageCount?: number;
  modelImageBytes?: number;
  spoilerFence?: SpoilerFence;
  /** 本轮开始时解析出的阅读位置与选区；未知或被隐私设置扣留时为空。 */
  readingRanges?: TurnReadingRanges;
  /** Completed-chapter memory boundary, separate from the inclusive prose fence. */
  bookMemoryBoundary?: import("../memory/book-memory-policy").BookGraphBoundary;
  /**
   * 本书本轮受剧透保护（叙事、未读完）。围栏可能缺席（位置未知），但图谱记忆
   * 仍按未知位置收紧，所以授权工具按保护而非按围栏提供。
   */
  spoilerProtected: boolean;
  /** 读者在本轮的授权卡片上同意越过阅读位置；只由 request_spoiler_access 设置，随轮重置。 */
  spoilersAllowed: boolean;
  /** 读者在本轮拒绝了授权：本轮不再追问。 */
  spoilerAccessDeclined: boolean;
}

export function createAgentTurnState(): AgentTurnState {
  return {
    presentedBookIds: new Set(),
    spoilerProtected: false,
    spoilersAllowed: false,
    spoilerAccessDeclined: false,
  };
}
