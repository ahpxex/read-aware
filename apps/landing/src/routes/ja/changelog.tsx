import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../../components/ChangelogPage";

export const Route = createFileRoute("/ja/changelog")({
  head: () => ({
    meta: [
      { title: "変更履歴 — ReadAware" },
      { name: "description", content: "ReadAwareの各リリースで何が変わったかを、使う人に向けて書いています。" },
    ],
  }),
  component: () => <ChangelogPage locale="ja" />,
});
