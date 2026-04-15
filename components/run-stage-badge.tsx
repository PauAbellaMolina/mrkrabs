import { STAGE_GLYPHS, STAGE_LABELS, type RunStage } from "@/lib/run-stage";

type Props = {
  stage: RunStage;
  size?: "sm" | "md";
  pulse?: boolean;
};

const STAGE_COLOR_VAR: Record<RunStage, string> = {
  running: "var(--stage-running)",
  done: "var(--stage-done)",
  submitted: "var(--stage-submitted)",
  "submit-failed": "var(--stage-submit-failed)",
  failed: "var(--stage-failed)",
};

export function RunStageBadge({ stage, size = "md", pulse = false }: Props) {
  const isActive = stage === "running";
  const shouldPulse = pulse || isActive;

  const padding = size === "sm" ? "px-2.5 py-1" : "px-3 py-1.5";
  const fontSize = size === "sm" ? "text-[9px]" : "text-[10px]";
  const tracking = size === "sm" ? "tracking-[0.18em]" : "tracking-[0.2em]";

  const color = STAGE_COLOR_VAR[stage];

  return (
    <span
      className={
        "inline-flex items-center gap-2 border font-mono uppercase " +
        `${padding} ${fontSize} ${tracking}`
      }
      style={{
        color,
        borderColor: color,
        backgroundColor: `color-mix(in oklab, ${color} 22%, var(--background))`,
      }}
      data-stage={stage}
    >
      <span aria-hidden className={shouldPulse ? "animate-pulse" : undefined}>
        {STAGE_GLYPHS[stage]}
      </span>
      {STAGE_LABELS[stage]}
    </span>
  );
}
