import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../agent-harness";
import { textResult } from "../../tools/tool-result";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../types";

const TOOL_BOOK_ID = "eval-tool-book" as Id;
const PLUGIN_TOOL = "plugin_recommend_passage";

function pluginTool(): AgentTool {
  return {
    name: PLUGIN_TOOL,
    label: "Recommend passage",
    description: "Return the plugin's recommended passage for the reader.",
    parameters: Type.Object({}),
    execute: async () => textResult({ passage: "The opening paragraph" }),
  };
}

function configureGlobalPlugin({ deps }: Parameters<NonNullable<AgentEvalScenario["setup"]>>[0]) {
  const tool = pluginTool();
  deps.extraTools = (scope) => (scope.kind === "global" ? [tool] : []);
}

function modelToolAssessment(
  observation: AgentEvalObservation,
  toolName: string,
  expected: "present" | "absent",
): EvalAssessment {
  const exposed = observation.modelRequests.some((request) => {
    const tools = request.context.tools;
    return (
      Array.isArray(tools) &&
      tools.some(
        (tool) =>
          tool &&
          typeof tool === "object" &&
          !Array.isArray(tool) &&
          tool.name === toolName,
      )
    );
  });
  const passed = expected === "present" ? exposed : !exposed;
  return assessmentFromChecks([
    {
      id: `tools.exposure.${toolName}`,
      category: "policy",
      passed,
      message: passed
        ? `${toolName} exposure matched ${expected}`
        : `${toolName} should have been ${expected} in model context`,
      expected,
      actual: exposed ? "present" : "absent",
    },
  ]);
}

export const toolsEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "tools",
  description: "Tool planning, host presentation behavior, and plugin scope exposure.",
  scenarios: [
    defineAgentEvalScenario({
      id: "shelf-query-presents-cards",
      description: "Fetches the real shelf and presents returned books through host-owned cards.",
      tags: ["tools", "shelf", "presentation", "global"],
      scope: { kind: "global", threadId: "tools-shelf" },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [
          { id: TOOL_BOOK_ID, title: "Visible Book", author: "A. Writer", status: "reading" },
        ],
      },
      turns: [{ text: "Show me every book currently on my shelf." }],
      expectation: {
        tools: {
          required: ["list_books", "present_books"],
          noErrors: true,
          maxCalls: 2,
        },
        interactions: { forbiddenKinds: ["question", "permission"] },
      },
    }),
    defineAgentEvalScenario({
      id: "global-plugin-tool",
      description: "Exposes and executes a plugin tool registered for global scope.",
      tags: ["tools", "plugin", "scope", "global"],
      scope: { kind: "global", threadId: "tools-plugin-global" },
      seed: { profile: "The reader has already completed onboarding." },
      setup: configureGlobalPlugin,
      turns: [
        {
          text: "Use the plugin's passage recommendation tool and tell me which passage it returns.",
        },
      ],
      expectation: {
        answer: { mustContain: ["opening paragraph"] },
        tools: { required: [PLUGIN_TOOL], noErrors: true },
      },
      criteria: { pluginTool: PLUGIN_TOOL, exposedIn: "global" },
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: { mustContain: ["opening paragraph"] },
            tools: { required: [PLUGIN_TOOL], noErrors: true },
          }),
          modelToolAssessment(observation, PLUGIN_TOOL, "present"),
        ),
    }),
    defineAgentEvalScenario({
      id: "book-hides-global-plugin-tool",
      description: "Does not expose a global-only plugin tool to the in-book agent.",
      tags: ["tools", "plugin", "scope", "book", "security"],
      scope: { kind: "book", bookId: TOOL_BOOK_ID },
      seed: {
        profile: "The reader has already completed onboarding.",
        books: [{ id: TOOL_BOOK_ID, title: "Visible Book", status: "reading" }],
      },
      setup: configureGlobalPlugin,
      turns: [
        {
          text: "Use plugin_recommend_passage if that tool is available here; otherwise say it is unavailable.",
        },
      ],
      expectation: { tools: { forbidden: [PLUGIN_TOOL] } },
      criteria: { pluginTool: PLUGIN_TOOL, exposedIn: "global-only" },
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, { tools: { forbidden: [PLUGIN_TOOL] } }),
          modelToolAssessment(observation, PLUGIN_TOOL, "absent"),
        ),
    }),
  ],
};
