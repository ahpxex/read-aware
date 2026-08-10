/**
 * 外链统一出口：Tauri 里 webview 会静默吞掉 target=_blank 的新窗口请求，
 * 必须经 opener 插件交给系统浏览器；纯浏览器 dev 环境回退 window.open。
 * 所有跳出 app 的链接（更新日志、官网、文档）都走这里。
 */
import { isTauri } from "./environment";

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
