/**
 * 一轮回复内的工具侧状态，thread 每轮 sendTurn 开始时重置/重算：
 * - presentedBookIds：出卡去重（见 present-tools）
 * - spoilerFence：剧透围栏 —— 叙事书且读者未读完时，正文工具越过
 *   游标章节需要宿主验证过的读者授权 + confirmSpoiler（见 book-text-tools）。
 */
export interface SpoilerFence {
  /** 可安全返回全文的最后章节；viewport 位于章内时会是当前章 - 1。 */
  throughChapterIndex: number;
  /** 仅用于面向模型的越界错误，保持读者所在章节坐标。 */
  readerChapterIndex?: number;
}

export interface AgentTurnState {
  presentedBookIds: Set<string>;
  spoilerFence?: SpoilerFence;
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
