import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DocsPageKey } from "../i18n";
import { MarkdownDoc } from "./MarkdownDoc";

const SLOT_PATTERN = /(READAWARE_CAPABILITY_BROWSER_SLOT|READAWARE_PERMISSION_PREVIEW_SLOT)/g;

type DocsPageSlots = {
  capabilityBrowser?: ReactNode;
  permissionPreview?: ReactNode;
};

export function LocalizedDocsPage({
  page,
  slots,
}: {
  page: DocsPageKey;
  slots?: DocsPageSlots;
}) {
  const { t } = useTranslation("docs");
  const body = t(`pages.${page}.body`);

  return (
    <article className="doc-prose">
      {body.split(SLOT_PATTERN).map((part, index) => {
        if (part === "READAWARE_CAPABILITY_BROWSER_SLOT") {
          return <Fragment key={part}>{slots?.capabilityBrowser}</Fragment>;
        }
        if (part === "READAWARE_PERMISSION_PREVIEW_SLOT") {
          return <Fragment key={part}>{slots?.permissionPreview}</Fragment>;
        }
        return (
          <Fragment key={`${index}:${part.slice(0, 20)}`}>
            <MarkdownDoc>{part}</MarkdownDoc>
          </Fragment>
        );
      })}
    </article>
  );
}
