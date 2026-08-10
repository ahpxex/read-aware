/**
 * 一轮回复内的工具侧状态，thread 每轮 sendTurn 开始时重置/重算：
 * - presentedBookIds：出卡去重（见 present-tools）
 * - spoilerFence：剧透围栏 —— 叙事书且读者未读完时，正文工具越过
 *   游标章节需要显式 confirmSpoiler（见 book-text-tools）。
 */
export interface SpoilerFence {
  /** 读者当前位置的章节 index（含）；之后的正文默认不可达。 */
  throughChapterIndex: number;
}

export interface AgentTurnState {
  presentedBookIds: Set<string>;
  spoilerFence?: SpoilerFence;
}

export function createAgentTurnState(): AgentTurnState {
  return { presentedBookIds: new Set() };
}
