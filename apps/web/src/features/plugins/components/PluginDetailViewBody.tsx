import { Detail, Metadata, Stack } from "@read-aware/ui";
import {
  DictionaryEntryBody,
  DictionaryEntryHeading,
} from "../../reader/components/DictionaryEntryBody";
import { renderPluginIcon } from "../lib/plugin-icons";
import type { PluginDetailView } from "../lib/plugin-types";
import { PluginActionGroup } from "./PluginActionGroup";
import { PluginBlocks } from "./PluginBlockRenderer";
import type { PluginResultRunner } from "./plugin-view-types";

type PluginDetailViewBodyProps = {
  view: PluginDetailView;
  stackDepth: number;
  busy: boolean;
  onResult: PluginResultRunner;
};

export function PluginDetailViewBody({
  view,
  stackDepth,
  busy,
  onResult,
}: PluginDetailViewBodyProps) {
  const firstBlock = view.content[0];
  const dictionary = firstBlock?.kind === "dictionary" ? firstBlock.entry : null;
  const remainingContent = dictionary ? view.content.slice(1) : view.content;
  const metadata = view.metadata && view.metadata.length > 0
    ? (
        <Metadata layout="horizontal">
          {view.metadata.map((item, index) => {
            if (item.kind === "divider") return <Metadata.Separator key={index} />;
            if (item.kind === "tags") {
              return <Metadata.Tags key={index} title={item.label} values={item.values} />;
            }
            return (
              <Metadata.Label
                key={index}
                title={item.label}
                value={item.value}
                icon={item.icon ? renderPluginIcon(item.icon, 15) : undefined}
              />
            );
          })}
        </Metadata>
      )
    : undefined;

  return (
    <Detail
      header={
        dictionary ? (
          <DictionaryEntryHeading
            headword={dictionary.headword}
            pronunciation={dictionary.pronunciation}
          />
        ) : undefined
      }
      metadata={metadata}
      actions={
        view.actions && view.actions.length > 0 ? (
          <PluginActionGroup
            actions={view.actions}
            busy={busy}
            align="end"
            display="icons"
            onResult={onResult}
          />
        ) : undefined
      }
    >
      {dictionary ? (
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
      )}
    </Detail>
  );
}
