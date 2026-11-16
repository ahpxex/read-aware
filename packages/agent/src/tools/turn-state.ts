/**
 * 一轮回复内的工具侧状态，thread 每轮 sendTurn 开始时重置/重算：
 * - presentedBookIds：出卡去重（见 present-tools）
 * - spoilerFence：剧透围栏 —— 叙事书且读者未读完时，正文工具越过
 *   游标章节需要宿主验证过的读者授权 + confirmSpoiler（见 book-text-tools）。
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
  /** On-demand schemas, bounded and reset with each user turn. */
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
  /** 宿主从本轮用户原话或 ask_user 回答中确定性验证出的剧透授权。 */
  spoilerPermissionGranted: boolean;
  /** 模型试图在无读者授权时使用 confirmSpoiler；最终回包必须安全降级。 */
  spoilerPermissionDenied: boolean;
  /** 本轮已经通过 confirmSpoiler=true 成功取得越界正文。 */
  spoilerGranted: boolean;
  /** 本轮正文工具实际返回、可用于最终回答的宿主证据。 */
  evidenceTexts: string[];
}

export function createAgentTurnState(): AgentTurnState {
  return {
    presentedBookIds: new Set(),
    spoilerPermissionGranted: false,
    spoilerPermissionDenied: false,
    spoilerGranted: false,
    evidenceTexts: [],
  };
}
