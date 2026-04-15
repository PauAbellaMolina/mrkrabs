"use client";

import type { ReactNode } from "react";
import type { EntityEventsIndex } from "@/lib/entity-events";
import { EntityPill } from "./entity-pill";

// Hand-rolled, dependency-free renderer for the agent's reportMarkdown.
// The report's shape is deterministic (see renderReportMarkdown in
// lib/codex-agent.ts), so we don't need a full parser — a line-by-line
// classifier handles h1/h2/h3/bullets/paragraphs. Inside every line we
// swap the agent's entity tag:
//   <entity UUID="...">Company Name</entity>
// for an inline <EntityPill />, which lets the reader click through to
// the exact Cala tool call the agent made for that entity. Every piece
// of text passes through JSX text nodes (auto-escaped), so any stray
// angle brackets render as literal text without touching raw HTML.

const ENTITY_TAG_PATTERN = /<entity\s+UUID="([^"]+)">([^<]+)<\/entity>/gi;

type Props = {
  markdown: string;
  toolEvents?: EntityEventsIndex;
  companyByUuid?: Map<string, string>;
};

export function ReportRenderer({ markdown, toolEvents, companyByUuid }: Props) {
  if (!markdown || markdown.trim().length === 0) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
        No report available.
      </p>
    );
  }

  const lookup = companyByUuid ?? new Map<string, string>();
  const blocks = parseBlocks(markdown);

  return (
    <div className="max-h-[720px] overflow-auto">
      <div className="flex flex-col gap-1 pr-2">
        {blocks.map((block, idx) => (
          <Block
            key={idx}
            block={block}
            toolEvents={toolEvents}
            companyByUuid={lookup}
          />
        ))}
      </div>
    </div>
  );
}

type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "paragraph"; text: string }
  | { kind: "spacer" };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  let bulletBuffer: string[] | null = null;
  let paragraphBuffer: string[] | null = null;

  const flushBullets = () => {
    if (bulletBuffer && bulletBuffer.length > 0) {
      blocks.push({ kind: "bullets", items: bulletBuffer });
    }
    bulletBuffer = null;
  };
  const flushParagraph = () => {
    if (paragraphBuffer && paragraphBuffer.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraphBuffer.join(" ") });
    }
    paragraphBuffer = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.length === 0) {
      flushBullets();
      flushParagraph();
      continue;
    }
    if (line.startsWith("### ")) {
      flushBullets();
      flushParagraph();
      blocks.push({ kind: "h3", text: line.slice(4).trim() });
      continue;
    }
    if (line.startsWith("## ")) {
      flushBullets();
      flushParagraph();
      blocks.push({ kind: "h2", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("# ")) {
      flushBullets();
      flushParagraph();
      blocks.push({ kind: "h1", text: line.slice(2).trim() });
      continue;
    }
    const bulletMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      if (!bulletBuffer) bulletBuffer = [];
      bulletBuffer.push(bulletMatch[2]);
      continue;
    }
    flushBullets();
    if (!paragraphBuffer) paragraphBuffer = [];
    paragraphBuffer.push(line.trim());
  }
  flushBullets();
  flushParagraph();
  return blocks;
}

function Block({
  block,
  toolEvents,
  companyByUuid,
}: {
  block: Block;
  toolEvents?: EntityEventsIndex;
  companyByUuid: Map<string, string>;
}) {
  const renderInline = (text: string) =>
    renderInlineWithEntityTags(text, toolEvents, companyByUuid);

  if (block.kind === "h1") {
    return (
      <h1 className="mt-4 mb-3 font-sans text-xl font-semibold tracking-tight text-[color:var(--foreground)]">
        {renderInline(block.text)}
      </h1>
    );
  }
  if (block.kind === "h2") {
    return (
      <h2 className="mt-6 mb-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted-foreground)]">
        {renderInline(block.text)}
      </h2>
    );
  }
  if (block.kind === "h3") {
    return (
      <h3 className="mt-5 mb-1.5 font-sans text-sm font-semibold text-[color:var(--foreground)]">
        {renderInline(block.text)}
      </h3>
    );
  }
  if (block.kind === "bullets") {
    return (
      <ul className="list-none space-y-1 pl-0">
        {block.items.map((item, idx) => (
          <li
            key={idx}
            className="flex gap-2 font-sans text-[13px] leading-6 text-[color:var(--foreground)]"
          >
            <span aria-hidden className="font-mono text-[color:var(--muted-foreground)]">
              ·
            </span>
            <span className="flex-1">{renderInline(item)}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === "paragraph") {
    return (
      <p className="font-sans text-sm leading-6 text-[color:var(--foreground)]">
        {renderInline(block.text)}
      </p>
    );
  }
  return null;
}

function renderInlineWithEntityTags(
  text: string,
  toolEvents: EntityEventsIndex | undefined,
  companyByUuid: Map<string, string>,
): ReactNode {
  const matches = Array.from(text.matchAll(ENTITY_TAG_PATTERN));
  if (matches.length === 0) return text;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(
        <span key={`t-${lastIndex}`}>{text.slice(lastIndex, start)}</span>,
      );
    }
    const uuid = match[1];
    const label = match[2].trim();
    const fallback = companyByUuid.get(uuid.toLowerCase());
    nodes.push(
      <EntityPill
        key={`p-${start}`}
        uuid={uuid}
        label={label || fallback}
        toolEvents={toolEvents}
        size="xs"
      />,
    );
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return nodes;
}
