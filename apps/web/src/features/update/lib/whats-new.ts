/**
 * 升级后的"看看更新了什么"提示：版本号相对上次运行发生变化时出现一次，
 * 用户可手动关闭，或在 48 小时后自然过期。纯 localStorage 状态机——
 * 这是 UI 提示的存续状态，不进事件日志。
 */
const STORAGE_KEY = "read-aware-whats-new";

/** 提示的自然寿命：过了这个窗口不再打扰。 */
export const WHATS_NEW_TTL_MS = 48 * 60 * 60 * 1000;

const CHANGELOG_BASE = "https://readaware.app";

type WhatsNewNoticeState = {
  version: string;
  shownAt: number;
  dismissed: boolean;
};

type WhatsNewState = {
  lastSeenVersion: string;
  notice?: WhatsNewNoticeState;
};

function readState(): WhatsNewState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WhatsNewState;
    return typeof parsed?.lastSeenVersion === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeState(state: WhatsNewState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时提示退化为"本次会话内"——不值得为它报错
  }
}

/**
 * 启动时对账：返回当前应活跃的提示（没有则 null）。
 * - 首次运行只记录版本，不提示（新装用户没有"更新"可看）；
 * - 版本变化 → 开一条新提示；
 * - 版本未变 → 沿用未关闭且未过期的提示。
 */
export function reconcileWhatsNew(
  currentVersion: string,
  now: number = Date.now(),
): { version: string } | null {
  const stored = readState();
  if (!stored) {
    writeState({ lastSeenVersion: currentVersion });
    return null;
  }
  if (stored.lastSeenVersion !== currentVersion) {
    writeState({
      lastSeenVersion: currentVersion,
      notice: { version: currentVersion, shownAt: now, dismissed: false },
    });
    return { version: currentVersion };
  }
  const notice = stored.notice;
  if (
    !notice ||
    notice.dismissed ||
    notice.version !== currentVersion ||
    now - notice.shownAt > WHATS_NEW_TTL_MS
  ) {
    return null;
  }
  return { version: notice.version };
}

export function dismissWhatsNew(): void {
  const stored = readState();
  if (!stored?.notice) return;
  writeState({ ...stored, notice: { ...stored.notice, dismissed: true } });
}

/** app 语言 → 官网更新日志路由（官网只有 en/zh/ja 三种）。 */
export function changelogUrlForLocale(locale: string): string {
  if (locale.startsWith("zh")) return `${CHANGELOG_BASE}/zh/changelog`;
  if (locale.startsWith("ja")) return `${CHANGELOG_BASE}/ja/changelog`;
  return `${CHANGELOG_BASE}/changelog`;
}
