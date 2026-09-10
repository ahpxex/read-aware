import { useLayoutEffect, useRef, useState } from "react";
import { AppError } from "@read-aware/core";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { hostConnectionTestFlows, hostMaintenance } from "../../../services/maintenance";
import type { AIConfig } from "../../ai/lib/ai-config";
import { nativeConnectionTest } from "../lib/test-ai-connection";

const log = createLogger("ai-connection-test");

export function useAIConnectionTest(config: AIConfig, canTest: boolean, beforeTest: () => void) {
  const { t } = useTranslation("settings");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const active = useRef(false), epoch = useRef(0), mounted = useRef(false);
  const latest = useRef({ config, canTest, beforeTest }); latest.current = { config, canTest, beforeTest };
  const resetTest = () => { epoch.current++; setTestResult(null); };
  useLayoutEffect(() => {
    mounted.current = true;
    const off = hostConnectionTestFlows.bind({
      open: () => {
        if (active.current) throw new AppError("ui/unavailable", "Connection test is already running");
        hostMaintenance.revealControl("ai-connection");
      },
      close: () => {}, // No extra dialog or automatic action to dismiss.
    });
    return () => { mounted.current = false; epoch.current++; off(); };
  }, []);

  const handleTest = async () => {
    if (active.current || !latest.current.canTest) return;
    active.current = true; setIsTesting(true); setTestResult(null);
    const generation = epoch.current;
    try {
      const response = await hostConnectionTestFlows.run("test", async signal => {
        signal?.throwIfAborted();
        const accepted = structuredClone(latest.current.config);
        latest.current.beforeTest();
        const result = await nativeConnectionTest.run(accepted);
        // Changing the form/unmounting cannot certify a different configuration.
        if (epoch.current !== generation) throw new AppError("ui/superseded", "Test configuration changed");
        return result;
      });
      if (mounted.current && epoch.current === generation) setTestResult(response
        ? { success: true, message: t("aiConfig.testSuccessMessage", { response }) }
        : { success: false, message: t("aiConfig.testEmptyMessage") });
    } catch (error) {
      log.error("AI connection test failed", error);
      if (mounted.current && epoch.current === generation) setTestResult({ success: false,
        message: describeError(error, { fallback: t("aiConfig.testUnknownError") }).body });
    } finally {
      active.current = false;
      if (mounted.current) setIsTesting(false);
    }
  };
  return { isTesting, testResult, handleTest, resetTest };
}
