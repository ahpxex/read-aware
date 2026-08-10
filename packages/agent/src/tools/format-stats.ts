/**
 * 阅读统计的模型呈现层：领域对象里的毫秒计数（totalMs / daily）在进入
 * 上下文前一律转成人类可读时长，模型不应该看到裸毫秒——否则它会把
 * "5427000" 原样念给用户。locator/CFI 这类运行时反查键同理裁掉。
 */
import type { BookStats, StatsOverview } from "@read-aware/core";

/** 阅读时长按分钟粒度呈现："42m"、"3h 5m"；不足一分钟给 "under 1m"。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return "under 1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** daily 只保留最近的活跃日，date 键已是 YYYY-MM-DD，值转成可读时长。 */
const RECENT_DAILY_LIMIT = 14;

function presentDaily(daily: Record<string, number>): Record<string, string> {
  const recent = Object.entries(daily)
    .filter(([, ms]) => ms > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-RECENT_DAILY_LIMIT);
  return Object.fromEntries(recent.map(([day, ms]) => [day, formatDuration(ms)]));
}

function activeDays(daily: Record<string, number>): number {
  return Object.values(daily).filter((ms) => ms > 0).length;
}

export function presentBookStats(stats: BookStats) {
  return {
    bookId: stats.bookId,
    status: stats.status,
    progressPercent: stats.progressPercent,
    ...(stats.currentLocation !== undefined && stats.totalLocations
      ? { location: `${stats.currentLocation} of ${stats.totalLocations}` }
      : {}),
    totalReadingTime: formatDuration(stats.totalMs),
    activeDays: activeDays(stats.daily),
    ...(stats.firstReadAt ? { firstReadAt: stats.firstReadAt } : {}),
    ...(stats.lastReadAt ? { lastReadAt: stats.lastReadAt } : {}),
    recentDailyReadingTime: presentDaily(stats.daily),
  };
}

export function presentStatsOverview(overview: StatsOverview) {
  return {
    totalReadingTime: formatDuration(overview.totalMs),
    activeDays: activeDays(overview.daily),
    booksReading: overview.booksReading,
    booksFinished: overview.booksFinished,
    ...(overview.firstReadAt ? { firstReadAt: overview.firstReadAt } : {}),
    ...(overview.lastReadAt ? { lastReadAt: overview.lastReadAt } : {}),
    recentDailyReadingTime: presentDaily(overview.daily),
  };
}
