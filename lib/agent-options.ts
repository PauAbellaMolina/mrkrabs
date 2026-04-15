// Single source of truth for the agent/backend/model matrix the UI exposes.
// The API routes (app/api/agent and app/api/autoresearch/run) mirror the
// `modelId` strings in their allow-lists.

export type AgentBackend = "codex-cli" | "anthropic";

export type AnthropicFamilyId = "haiku" | "sonnet" | "opus";

export interface AnthropicVariant {
  id: string;
  label: string;
  modelId: string;
}

export interface AnthropicFamily {
  id: AnthropicFamilyId;
  label: string;
  variants: AnthropicVariant[];
}

export const ANTHROPIC_FAMILIES: AnthropicFamily[] = [
  {
    id: "haiku",
    label: "Haiku 4.5",
    variants: [
      { id: "standard", label: "Standard", modelId: "claude-haiku-4-5" },
      {
        id: "dated",
        label: "Dated 2025-10-01",
        modelId: "claude-haiku-4-5-20251001",
      },
    ],
  },
  {
    id: "sonnet",
    label: "Sonnet 4.6",
    variants: [
      { id: "standard", label: "200K context", modelId: "claude-sonnet-4-6" },
      {
        id: "long-context",
        label: "1M context",
        modelId: "claude-sonnet-4-6[1m]",
      },
    ],
  },
  {
    id: "opus",
    label: "Opus 4.6",
    variants: [
      { id: "standard", label: "200K context", modelId: "claude-opus-4-6" },
      {
        id: "long-context",
        label: "1M context",
        modelId: "claude-opus-4-6[1m]",
      },
    ],
  },
];

export const DEFAULT_ANTHROPIC_FAMILY: AnthropicFamilyId = "sonnet";
export const DEFAULT_ANTHROPIC_VARIANT = "standard";

export function findAnthropicFamily(
  id: AnthropicFamilyId,
): AnthropicFamily {
  const family = ANTHROPIC_FAMILIES.find(f => f.id === id);
  if (!family) throw new Error(`Unknown Anthropic family: ${id}`);
  return family;
}

export function resolveAnthropicModelId(
  familyId: AnthropicFamilyId,
  variantId: string,
): string {
  const family = findAnthropicFamily(familyId);
  const variant =
    family.variants.find(v => v.id === variantId) ?? family.variants[0];
  return variant.modelId;
}
