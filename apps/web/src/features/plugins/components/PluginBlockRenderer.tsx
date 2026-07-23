import {
  Alert,
  Body,
  Caption,
  Columns,
  DefinitionList,
  Divider,
  Eyebrow,
  Heading,
  Metric,
  Progress,
  Quote,
  Section,
  Stack,
  Tag,
} from "@read-aware/ui";
import { Markdown } from "../../ai/components/Markdown";
import {
  DictionaryEntryBody,
  DictionaryEntryHeading,
} from "../../reader/components/DictionaryEntryBody";
import type { PluginBlock, PluginLayoutGap } from "../lib/plugin-types";
import { PluginActionGroup } from "./PluginActionGroup";
import { PluginFormViewBody } from "./PluginFormViewBody";
import { PluginListViewBody } from "./PluginListViewBody";
import type { PluginResultRunner } from "./plugin-view-types";

type PluginBlocksProps = {
  blocks: PluginBlock[];
  gap?: PluginLayoutGap;
  stackDepth: number;
  busy: boolean;
  onResult: PluginResultRunner;
};

const gapMap = {
  tight: "sm",
  normal: "md",
  relaxed: "lg",
} as const;

const toneClasses = {
  default: "text-fg",
  muted: "text-fg-muted",
  subtle: "text-fg-subtle",
} as const;

export function PluginBlocks({
  blocks,
  gap = "normal",
  stackDepth,
  busy,
  onResult,
}: PluginBlocksProps) {
  return (
    <Stack gap={gapMap[gap]}>
      {blocks.map((block, index) => (
        <PluginBlockRenderer
          key={index}
          block={block}
          stackDepth={stackDepth}
          busy={busy}
          onResult={onResult}
        />
      ))}
    </Stack>
  );
}

function PluginBlockRenderer({
  block,
  stackDepth,
  busy,
  onResult,
}: {
  block: PluginBlock;
  stackDepth: number;
  busy: boolean;
  onResult: PluginResultRunner;
}) {
  if (block.kind === "markdown") {
    return <Markdown className="text-sm leading-6">{block.markdown}</Markdown>;
  }
  if (block.kind === "text") {
    const tone = toneClasses[block.tone ?? "default"];
    if (block.variant === "heading") {
      return <Heading size="xl" className={tone}>{block.text}</Heading>;
    }
    if (block.variant === "eyebrow") return <Eyebrow className={tone}>{block.text}</Eyebrow>;
    if (block.variant === "caption") return <Caption className={tone}>{block.text}</Caption>;
    return <Body className={`text-sm leading-6 ${tone}`}>{block.text}</Body>;
  }
  if (block.kind === "heading") {
    return (
      <Stack gap="xs">
        <Eyebrow>{block.text}</Eyebrow>
        {block.caption && <Caption className="text-fg-muted">{block.caption}</Caption>}
      </Stack>
    );
  }
  if (block.kind === "dictionary") {
    return (
      <Stack gap="md">
        <DictionaryEntryHeading
          headword={block.entry.headword}
          pronunciation={block.entry.pronunciation}
        />
        <DictionaryEntryBody entry={block.entry} />
      </Stack>
    );
  }
  if (block.kind === "keyValue") {
    return (
      <DefinitionList
        items={block.rows}
        variant={block.layout ?? "inline"}
        columns={block.columns ?? 1}
      />
    );
  }
  if (block.kind === "quote") {
    return <Quote attribution={block.caption}>{block.text}</Quote>;
  }
  if (block.kind === "actions") {
    return (
      <PluginActionGroup
        actions={block.actions}
        busy={busy}
        align={block.align}
        onResult={onResult}
      />
    );
  }
  if (block.kind === "metric") {
    return <Metric label={block.label} value={block.value} description={block.description} />;
  }
  if (block.kind === "progress") {
    return (
      <Progress
        value={block.value}
        max={block.max}
        label={block.label}
        showValue={block.showValue}
      />
    );
  }
  if (block.kind === "tags") {
    return (
      <Stack gap="sm">
        {block.label && <Caption className="text-fg-subtle">{block.label}</Caption>}
        <Stack direction="horizontal" gap="sm" align="center" wrap>
          {block.values.map((value) => <Tag key={value}>{value}</Tag>)}
        </Stack>
      </Stack>
    );
  }
  if (block.kind === "alert") {
    return <Alert title={block.title} variant={block.variant}>{block.message}</Alert>;
  }
  if (block.kind === "divider") return <Divider />;
  if (block.kind === "section") {
    return (
      <Section title={block.title} description={block.description}>
        <PluginBlocks
          blocks={block.blocks}
          gap={block.gap}
          stackDepth={stackDepth}
          busy={busy}
          onResult={onResult}
        />
      </Section>
    );
  }
  if (block.kind === "group") {
    return (
      <PluginBlocks
        blocks={block.blocks}
        gap={block.gap}
        stackDepth={stackDepth}
        busy={busy}
        onResult={onResult}
      />
    );
  }
  if (block.kind === "columns") {
    return (
      <Columns gap={gapMap[block.gap ?? "normal"]} align={block.align}>
        {block.cells.map((cell, index) => (
          <Columns.Item key={index} weight={cell.weight} minWidth={cell.minWidth}>
            <PluginBlocks
              blocks={cell.blocks}
              stackDepth={stackDepth}
              busy={busy}
              onResult={onResult}
            />
          </Columns.Item>
        ))}
      </Columns>
    );
  }
  if (block.kind === "row") {
    return (
      <Columns align={block.align}>
        {block.cells.map((cell, index) => (
          <Columns.Item key={index} weight={cell.weight} minWidth="compact">
            <PluginBlockRenderer
              block={cell.block}
              stackDepth={stackDepth}
              busy={busy}
              onResult={onResult}
            />
          </Columns.Item>
        ))}
      </Columns>
    );
  }
  if (block.kind === "list") {
    return <PluginListViewBody view={block} busy={busy} onResult={onResult} />;
  }
  return <PluginFormViewBody key={stackDepth} view={block} busy={busy} onResult={onResult} />;
}
