import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../../components/ChangelogPage";

export const Route = createFileRoute("/zh/changelog")({
  head: () => ({
    meta: [
      { title: "更新日志 — ReadAware" },
      { name: "description", content: "ReadAware 每一版改了什么，写给用它的人看。" },
    ],
  }),
  component: () => <ChangelogPage locale="zh" />,
});
