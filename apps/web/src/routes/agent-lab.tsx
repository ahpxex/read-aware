import { createFileRoute } from "@tanstack/react-router";
import { AgentLabPage } from "../dev/agent-lab/AgentLabPage";

export const Route = createFileRoute("/agent-lab")({
  component: AgentLabPage,
});
