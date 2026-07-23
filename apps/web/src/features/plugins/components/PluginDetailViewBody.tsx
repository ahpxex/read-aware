import { Detail, Stack } from "@read-aware/ui";
import {
  DictionaryEntryBody,
  DictionaryEntryHeading,
} from "../../reader/components/DictionaryEntryBody";
import type { PluginDetailView } from "../lib/plugin-types";
import { PluginActionGroup } from "./PluginActionGroup";
import { PluginBlocks } from "./PluginBlockRenderer";
import { PluginControlGroup } from "./PluginControlGroup";
import { PluginMetadata, PluginMetadataLine } from "./PluginMetadata";
import type { PluginResultRunner } from "./plugin-view-types";

type PluginDetailViewBodyProps = {
  view: PluginDetailView;
  stackDepth: number;
  busy: boolean;
  onResult: PluginResultRunner;
  /** Dialog hosts move commands into their fixed footer. */
  showActions?: boolean;
  /** Dialog hosts keep secondary metadata directly beneath the heading. */
  metadataPresentation?: "footer" | "header";
  /** Keep the heading fixed and scroll only the detail body. */
  scrollBody?: boolean;
};

export function PluginDetailViewBody({
  view,
  stackDepth,
  busy,
  onResult,
  showActions = true,
  metadataPresentation = "footer",
  scrollBody = false,
}: PluginDetailViewBodyProps) {
  const firstBlock = view.content[0];
  const dictionary = firstBlock?.kind === "dictionary" ? firstBlock.entry : null;
  const remainingContent = dictionary ? view.content.slice(1) : view.content;
  const hasMetadata = Boolean(view.metadata && view.metadata.length > 0);
  const content = dictionary ? (
    <Stack gap="lg">
      <DictionaryEntryBody entry={dictionary} />
      {remainingContent.length > 0 && (
        <PluginBlocks
          blocks={remainingContent}
          gap="relaxed"
          stackDepth={stackDepth}
          busy={busy}
          onResult={onResult}
        />
      )}
    </Stack>
  ) : (
    <PluginBlocks
      blocks={remainingContent}
      gap="relaxed"
      stackDepth={stackDepth}
      busy={busy}
      onResult={onResult}
    />
  );

  return (
    <Detail
      className={scrollBody ? "min-h-0 flex-1" : undefined}
      bodyClassName={scrollBody ? "pr-3" : undefined}
      scrollable={scrollBody}
      header={
        dictionary ? (
          <Stack gap="sm" className="min-w-0">
            <DictionaryEntryHeading
              headword={dictionary.headword}
              pronunciation={dictionary.pronunciation}
            />
            {metadataPresentation === "header" && hasMetadata && (
              <PluginMetadataLine items={view.metadata!} />
            )}
          </Stack>
        ) : metadataPresentation === "header" && hasMetadata ? (
          <PluginMetadataLine items={view.metadata!} />
        ) : undefined
      }
      metadata={
        metadataPresentation === "footer" && hasMetadata ? (
          <PluginMetadata items={view.metadata!} />
        ) : undefined
      }
      actions={
        (view.controls && view.controls.length > 0) ||
        (showActions && view.actions && view.actions.length > 0) ? (
          <Stack direction="horizontal" gap="sm" align="center" justify="end" wrap>
            {view.controls && view.controls.length > 0 && (
              <PluginControlGroup controls={view.controls} busy={busy} onResult={onResult} />
            )}
            {showActions && view.actions && view.actions.length > 0 && (
              <PluginActionGroup
                actions={view.actions}
                busy={busy}
                align="end"
                display="icons"
                onResult={onResult}
              />
            )}
          </Stack>
        ) : undefined
      }
    >
      {content}
    </Detail>
  );
}
