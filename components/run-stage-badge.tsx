import { STAGE_GLYPHS, STAGE_LABELS, type RunStage } from "@/lib/run-stage";

type Props = {
  stage: RunStage;
  size?: "sm" | "md";
  pulse?: boolean;
};

export function RunStageBadge({ stage, size = "md", pulse = false }: Props) {
  const isActive = stage === "running";
  const shouldPulse = pulse || isActive;

  const padding = size === "sm" ? "px-2.5 py-1" : "px-3 py-1.5";
  const fontSize = size === "sm" ? "text-[9px]" : "text-[10px]";
  const tracking = size === "sm" ? "tracking-[0.18em]" : "tracking-[0.2em]";

  return (
    <span
      className={
        "inline-flex items-center gap-2 border border-[color:var(--border)] " +
        `bg-[color:var(--background)] font-mono uppercase ${padding} ${fontSize} ${tracking} ` +
        "text-[color:var(--foreground)]"
      }
      data-stage={stage}
    >
      <span aria-hidden className={shouldPulse ? "animate-pulse" : undefined}>
        {STAGE_GLYPHS[stage]}
      </span>
      {STAGE_LABELS[stage]}
    </span>
  );
}
