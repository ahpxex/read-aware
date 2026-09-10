import { testLlmConnection } from "@read-aware/agent";
import { appHttpFetch } from "../../../platform/http-client";
import { accountFromConfig } from "../../ai/agent/account";
import { inferencePolicy } from "../../ai/agent/inference-policy";
import type { AIConfig } from "../../ai/lib/ai-config";

/** Native configuration only. The public flow never accepts credentials or destinations. */
export const nativeConnectionTest = {
  async run(config: AIConfig): Promise<string> {
    const { account, models } = accountFromConfig(config);
    return testLlmConnection(account, models.smart, { fetch: appHttpFetch, inferencePolicy });
  },
};
