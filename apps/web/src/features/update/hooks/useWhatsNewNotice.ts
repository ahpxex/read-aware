import { useCallback, useEffect, useState } from "react";
import { readCurrentAppVersion } from "../lib/software-update";
import { dismissWhatsNew, reconcileWhatsNew } from "../lib/whats-new";

/**
 * 升级后的更新日志提示：启动时和存储对账一次。浏览器 dev 环境读不到
 * 版本号（非 Tauri），提示自然缺席。
 */
export function useWhatsNewNotice(): {
  notice: { version: string } | null;
  dismiss: () => void;
} {
  const [notice, setNotice] = useState<{ version: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readCurrentAppVersion().then((version) => {
      if (!cancelled && version) setNotice(reconcileWhatsNew(version));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    dismissWhatsNew();
    setNotice(null);
  }, []);

  return { notice, dismiss };
}
