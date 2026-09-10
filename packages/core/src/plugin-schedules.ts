export type PluginScheduleOutcome = "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export type PluginScheduleState = {
  pluginId: string; id: string; label: string; everyMinutes: number;
  paused: boolean; running: boolean; lastStartedAt: number | null;
  lastFinishedAt: number | null; lastSuccessAt: number | null;
  lastOutcome: PluginScheduleOutcome | null; lastErrorCode: string | null;
};
export type PluginSchedulePage = { schedules: PluginScheduleState[]; total: number; nextOffset: number | null };
export type PluginScheduleQuery = { pluginId?: string; offset?: number; limit?: number };
export type PluginScheduleControl = { pluginId: string; id: string; action: "pause" | "resume" | "run" };
export type PluginScheduleReceipt = { status: "completed" | "already-running"; schedule: PluginScheduleState };
