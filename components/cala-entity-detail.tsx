"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type CalaData = {
  id: string;
  entityType?: string;
  properties?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  numericalObservations?: Array<Record<string, unknown>>;
  knowledge?: {
    content?: string;
    explainability?: Array<Record<string, unknown>>;
    context?: Array<Record<string, unknown>>;
  } | null;
};

type Props = {
  uuid: string;
  companyName?: string;
};

export function CalaEntityDetail({ uuid, companyName }: Props) {
  const [data, setData] = useState<CalaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    const run = () => {
      fetch(`/api/cala/entity/${uuid}`, { signal: controller.signal })
        .then(async res => {
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `HTTP ${res.status}`);
          }
          return res.json() as Promise<CalaData>;
        })
        .then(result => {
          if (!cancelled) setData(result);
        })
        .catch(err => {
          if (cancelled) return;
          if (err instanceof DOMException && err.name === "AbortError") {
            setError("Cala request timed out");
          } else {
            setError(err instanceof Error ? err.message : "Failed");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
          window.clearTimeout(timeout);
        });
    };
    const handle = window.setTimeout(run, 0);
    return () => { cancelled = true; window.clearTimeout(handle); window.clearTimeout(timeout); controller.abort(); };
  }, [uuid]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-6">
        <span className="inline-block h-2 w-2 animate-pulse bg-[color:var(--foreground)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          Fetching from Cala…
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-3 py-3">
        <Image
          src="/cala-logo.png"
          alt="Cala"
          width={40}
          height={14}
          className="opacity-40"
          unoptimized
        />
        <p className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
          Live data unavailable for this entity
          {companyName ? ` (${companyName})` : ""}
        </p>
      </div>
    );
  }

  const props = data.properties ?? {};
  const rels = data.relationships ?? {};
  const knowledge = data.knowledge;

  // Separate "headline" company fields from the rest so they render
  // as a prominent profile card rather than buried in a flat grid.
  const { profile, remaining } = extractProfile(props);

  return (
    <div className="animate-[fadeSlideIn_0.4s_ease-out] flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] pb-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-sans text-lg font-semibold text-[color:var(--foreground)]">
            {companyName ?? data.id}
          </span>
          {data.entityType ? (
            <span className="border border-[color:var(--border)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              {data.entityType}
            </span>
          ) : null}
          <span className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
            {uuid}
          </span>
        </div>
        <CalaBadge />
      </div>

      {profile.length > 0 ? (
        <div className="animate-[fadeSlideIn_0.35s_ease-out_0.05s_both]">
          <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Company profile from Cala
          </p>
          <div className="grid grid-cols-2 gap-px overflow-hidden border border-[color:var(--border)] bg-[color:var(--border)] sm:grid-cols-3 lg:grid-cols-4">
            {profile.map(([key, value], idx) => (
              <div
                key={key}
                className="animate-[fadeSlideIn_0.25s_ease-out_both] bg-[color:var(--background)] px-3 py-2.5"
                style={{ animationDelay: `${idx * 35}ms` }}
              >
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  {humanize(key)}
                </p>
                <p className="mt-0.5 font-sans text-xs leading-5 text-[color:var(--foreground)]">
                  {formatValue(value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {knowledge?.content ? (
        <div className="animate-[fadeSlideIn_0.4s_ease-out_0.1s_both] flex flex-col gap-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Cala knowledge
          </p>
          <div className="cala-knowledge-content font-sans text-sm leading-6 text-[color:var(--foreground)]">
            <KnowledgeMarkdown content={knowledge.content} />
          </div>
        </div>
      ) : null}

      {knowledge?.explainability && knowledge.explainability.length > 0 ? (
        <div className="animate-[fadeSlideIn_0.4s_ease-out_0.15s_both] flex flex-col gap-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Explainability
          </p>
          <div className="flex flex-col gap-2">
            {knowledge.explainability.map((item, idx) => (
              <div
                key={idx}
                className="animate-[fadeSlideIn_0.25s_ease-out_both] border-l-2 border-[color:var(--border)] pl-3"
                style={{ animationDelay: `${200 + idx * 50}ms` }}
              >
                {Object.entries(item)
                  .filter(([, v]) => v != null && v !== "")
                  .map(([key, value]) => (
                    <p key={key} className="font-mono text-[11px] text-[color:var(--foreground)]">
                      <span className="text-[color:var(--muted-foreground)]">
                        {humanize(key)}:{" "}
                      </span>
                      {formatValue(value)}
                    </p>
                  ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {remaining.length > 0 ? (
        <PropertiesSection entries={remaining} />
      ) : null}

      {Object.keys(rels).length > 0 ? (
        <RelationshipsSection relationships={rels} />
      ) : null}

      {data.numericalObservations && data.numericalObservations.length > 0 ? (
        <ObservationsSection observations={data.numericalObservations} />
      ) : null}

      {knowledge?.context && knowledge.context.length > 0 ? (
        <div className="animate-[fadeSlideIn_0.4s_ease-out_0.3s_both] flex flex-col gap-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
            Additional context
          </p>
          <div className="flex flex-wrap gap-2">
            {knowledge.context.slice(0, 6).map((item, idx) => {
              const label = String(
                item.title ?? item.name ?? item.type ?? `#${idx + 1}`,
              );
              const detail = String(item.summary ?? item.description ?? item.value ?? "");
              return (
                <div
                  key={idx}
                  className="animate-[fadeSlideIn_0.25s_ease-out_both] border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2"
                  style={{ animationDelay: `${350 + idx * 40}ms` }}
                >
                  <p className="font-mono text-[10px] font-semibold text-[color:var(--foreground)]">
                    {label}
                  </p>
                  {detail ? (
                    <p className="mt-0.5 font-mono text-[10px] text-[color:var(--muted-foreground)]">
                      {detail.length > 120 ? detail.slice(0, 120) + "…" : detail}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CalaBadge() {
  return (
    <div className="flex items-center gap-2">
      <Image
        src="/cala-logo.png"
        alt="Cala"
        width={60}
        height={20}
        className="opacity-70"
        unoptimized
      />
      <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)] opacity-60">
        Verified data
      </span>
    </div>
  );
}

function PropertiesSection({ entries }: { entries: [string, unknown][] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        Properties
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 lg:grid-cols-3">
        {entries.map(([key, value], idx) => (
          <div
            key={key}
            className="animate-[fadeSlideIn_0.3s_ease-out_both]"
            style={{ animationDelay: `${idx * 40}ms` }}
          >
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
              {humanize(key)}
            </p>
            <p className="mt-0.5 font-mono text-xs text-[color:var(--foreground)]">
              {formatValue(value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RelationshipsSection({ relationships }: { relationships: Record<string, unknown> }) {
  const outgoing = extractRelList(relationships.outgoing ?? relationships.Outgoing);
  const incoming = extractRelList(relationships.incoming ?? relationships.Incoming);
  const namedRels = Object.entries(relationships).filter(
    ([key]) => !["outgoing", "incoming", "Outgoing", "Incoming"].includes(key),
  );

  if (outgoing.length === 0 && incoming.length === 0 && namedRels.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        Relationships
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {outgoing.length > 0 ? (
          <RelGroup label="Outgoing" items={outgoing} direction="out" />
        ) : null}
        {incoming.length > 0 ? (
          <RelGroup label="Incoming" items={incoming} direction="in" />
        ) : null}
      </div>
      {namedRels.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {namedRels.map(([key, value], idx) => (
            <span
              key={key}
              className="animate-[fadeSlideIn_0.3s_ease-out_both] border border-[color:var(--border)] bg-[color:var(--background)] px-2.5 py-1 font-mono text-[10px] text-[color:var(--foreground)]"
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <span className="text-[color:var(--muted-foreground)]">
                {humanize(key)}
              </span>
              {" → "}
              {formatValue(value)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type RelItem = { type: string; targetId?: string; targetName?: string; raw: unknown };

function extractRelList(value: unknown): RelItem[] {
  if (!value) return [];
  if (typeof value === "string") return [{ type: value, raw: value }];
  if (Array.isArray(value)) {
    return value.map((item, idx) => {
      if (typeof item === "string") return { type: item, raw: item };
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        return {
          type: String(obj.type ?? obj.relationship_type ?? obj.label ?? `#${idx + 1}`),
          targetId: typeof obj.target_id === "string" ? obj.target_id : typeof obj.id === "string" ? obj.id : undefined,
          targetName: typeof obj.target_name === "string" ? obj.target_name : typeof obj.name === "string" ? obj.name : undefined,
          raw: item,
        };
      }
      return { type: String(item), raw: item };
    });
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, val]) => ({
      type: key,
      targetName: typeof val === "string" ? val : undefined,
      raw: val,
    }));
  }
  return [];
}

function RelGroup({
  label,
  items,
  direction,
}: {
  label: string;
  items: RelItem[];
  direction: "in" | "out";
}) {
  const arrow = direction === "out" ? "→" : "←";
  return (
    <div className="flex flex-col gap-2 border border-[color:var(--border)] bg-[color:var(--background)] p-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        {label} ({items.length})
      </p>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, idx) => (
          <li
            key={idx}
            className="animate-[fadeSlideIn_0.25s_ease-out_both] flex items-baseline gap-2 font-mono text-[11px]"
            style={{ animationDelay: `${idx * 30}ms` }}
          >
            <span className="text-[color:var(--muted-foreground)]">{arrow}</span>
            <span className="font-semibold text-[color:var(--foreground)]">
              {item.type}
            </span>
            {item.targetName ? (
              <span className="text-[color:var(--muted-foreground)]">
                {item.targetName}
              </span>
            ) : item.targetId ? (
              <span className="text-[color:var(--muted-foreground)]">
                {item.targetId.slice(0, 8)}…
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ObservationsSection({
  observations,
}: {
  observations: Array<Record<string, unknown>>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
        Numerical observations ({observations.length})
      </p>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {observations.slice(0, 12).map((obs, idx) => {
          const label = String(obs.name ?? obs.type ?? obs.metric ?? `#${idx + 1}`);
          const value = obs.value ?? obs.count ?? obs.amount ?? obs.score;
          const unit = typeof obs.unit === "string" ? obs.unit : "";
          return (
            <div
              key={idx}
              className="animate-[fadeSlideIn_0.3s_ease-out_both] border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2"
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                {humanize(label)}
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[color:var(--foreground)]">
                {value != null ? String(value) : "—"}
                {unit ? ` ${unit}` : ""}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PROFILE_KEYS = new Set([
  "name", "legal_name", "legalName",
  "aliases", "ticker", "tickers", "stock_ticker",
  "exchange", "stock_exchange", "listed_on",
  "sector", "industry", "sic_code", "naics_code",
  "country", "state", "jurisdiction", "headquarters",
  "founded", "founding_date", "incorporation_date",
  "entity_type", "entityType", "type",
  "status", "active",
  "website", "url",
  "description", "summary",
  "cik", "ein", "lei",
]);

function extractProfile(props: Record<string, unknown>): {
  profile: [string, unknown][];
  remaining: [string, unknown][];
} {
  const profile: [string, unknown][] = [];
  const remaining: [string, unknown][] = [];
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    if (PROFILE_KEYS.has(key) || PROFILE_KEYS.has(key.toLowerCase())) {
      profile.push([key, value]);
    } else {
      remaining.push([key, value]);
    }
  }
  return { profile, remaining };
}

function KnowledgeMarkdown({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let tableBuffer: string[] = [];

  const flushBullets = () => {
    if (bulletBuffer.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-1 flex flex-col gap-1 pl-0">
          {bulletBuffer.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="font-mono text-[color:var(--muted-foreground)]">·</span>
              <span className="flex-1"><InlineMarkdown text={item} /></span>
            </li>
          ))}
        </ul>,
      );
      bulletBuffer = [];
    }
  };

  const flushTable = () => {
    if (tableBuffer.length < 2) {
      for (const row of tableBuffer) {
        elements.push(
          <p key={`p-${elements.length}`} className="my-1">
            <InlineMarkdown text={row} />
          </p>,
        );
      }
      tableBuffer = [];
      return;
    }
    const dataRows = tableBuffer.filter(r => !r.match(/^\s*\|[\s:-]+\|\s*$/));
    const parsed = dataRows.map(r =>
      r.split("|").map(c => c.trim()).filter(Boolean),
    );
    const header = parsed[0];
    const body = parsed.slice(1);
    elements.push(
      <div key={`tbl-${elements.length}`} className="my-2 overflow-auto">
        <table className="w-full border-collapse font-mono text-xs">
          {header ? (
            <thead>
              <tr className="border-b border-[color:var(--border)]">
                {header.map((cell, ci) => (
                  <th
                    key={ci}
                    className="px-3 py-2 text-left text-[9px] font-normal uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]"
                  >
                    <InlineMarkdown text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, ri) => (
              <tr
                key={ri}
                className="border-b border-[color:var(--border)]"
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-2 text-[color:var(--foreground)]"
                  >
                    <InlineMarkdown text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const isTableRow = line.startsWith("|") && line.endsWith("|");

    if (isTableRow) {
      flushBullets();
      tableBuffer.push(line);
      continue;
    }
    if (tableBuffer.length > 0) {
      flushTable();
    }

    if (line.length === 0) {
      flushBullets();
      continue;
    }
    if (line.startsWith("### ")) {
      flushBullets();
      elements.push(
        <h4 key={`h3-${elements.length}`} className="mt-3 mb-1 font-sans text-sm font-semibold text-[color:var(--foreground)]">
          <InlineMarkdown text={line.slice(4).trim()} />
        </h4>,
      );
      continue;
    }
    if (line.startsWith("## ")) {
      flushBullets();
      elements.push(
        <h3 key={`h2-${elements.length}`} className="mt-4 mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
          <InlineMarkdown text={line.slice(3).trim()} />
        </h3>,
      );
      continue;
    }
    if (line.startsWith("# ")) {
      flushBullets();
      elements.push(
        <h2 key={`h1-${elements.length}`} className="mt-4 mb-1 font-sans text-base font-semibold text-[color:var(--foreground)]">
          <InlineMarkdown text={line.slice(2).trim()} />
        </h2>,
      );
      continue;
    }
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletMatch) {
      bulletBuffer.push(bulletMatch[1]);
      continue;
    }
    flushBullets();
    elements.push(
      <p key={`p-${elements.length}`} className="my-1">
        <InlineMarkdown text={line} />
      </p>,
    );
  }
  flushBullets();
  flushTable();
  return <>{elements}</>;
}

function InlineMarkdown({ text }: { text: string }) {
  // Handle **bold** and *italic*
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/\*(.+?)\*/);

    const match = boldMatch && italicMatch
      ? (boldMatch.index! <= italicMatch.index! ? boldMatch : italicMatch)
      : (boldMatch ?? italicMatch);

    if (!match || match.index === undefined) {
      parts.push(<span key={keyIdx++}>{remaining}</span>);
      break;
    }

    if (match.index > 0) {
      parts.push(<span key={keyIdx++}>{remaining.slice(0, match.index)}</span>);
    }

    if (match[0].startsWith("**")) {
      parts.push(
        <strong key={keyIdx++} className="font-semibold">{match[1]}</strong>,
      );
    } else {
      parts.push(
        <em key={keyIdx++} className="italic">{match[1]}</em>,
      );
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return <>{parts}</>;
}

function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

function formatValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    const strs = value.filter(v => typeof v === "string");
    if (strs.length === value.length && strs.length <= 5) return strs.join(", ");
    return `${value.length} items`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length <= 3) {
      return entries.map(([k, v]) => `${k}: ${formatValue(v)}`).join(", ");
    }
    return `${entries.length} fields`;
  }
  return String(value);
}
