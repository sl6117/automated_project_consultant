export const DEFAULT_SESSION_CAP_CENTS = 500;
// 1 cent = 1,000,000 microcents; costs are integer microcents everywhere.
export const MICROCENTS_PER_CENT = 1_000_000;
export const DEFAULT_SESSION_CAP_MICROCENTS =
  DEFAULT_SESSION_CAP_CENTS * MICROCENTS_PER_CENT;

// Prices are microcents per token ($ per MTok x 100). They live here, with
// their effective date, and never at a call site.
export type ModelPricing = {
  effectiveDate: string;
  inputMicrocentsPerToken: number;
  outputMicrocentsPerToken: number;
  cacheReadMicrocentsPerToken: number;
  cacheWrite5mMicrocentsPerToken: number;
  cacheWrite1hMicrocentsPerToken: number;
};

export const modelCatalog = {
  fable: {
    alias: "fable" as const,
    apiId: "claude-fable-5",
    role: "consultant",
    pricing: {
      // $10/$50 per MTok, $1 cache reads, $12.50 5m writes, $20 1h writes.
      effectiveDate: "2026-08-26",
      inputMicrocentsPerToken: 1000,
      outputMicrocentsPerToken: 5000,
      cacheReadMicrocentsPerToken: 100,
      cacheWrite5mMicrocentsPerToken: 1250,
      cacheWrite1hMicrocentsPerToken: 2000,
    } satisfies ModelPricing,
  },
  sonnet: {
    alias: "sonnet" as const,
    apiId: "claude-sonnet-4-6",
    role: "specialist",
    pricing: {
      effectiveDate: "2026-08-26",
      inputMicrocentsPerToken: 300,
      outputMicrocentsPerToken: 1500,
      cacheReadMicrocentsPerToken: 30,
      cacheWrite5mMicrocentsPerToken: 375,
      cacheWrite1hMicrocentsPerToken: 600,
    } satisfies ModelPricing,
  },
} as const;

export type ModelAlias = keyof typeof modelCatalog;
