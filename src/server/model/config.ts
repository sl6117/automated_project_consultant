export const DEFAULT_SESSION_CAP_CENTS = 500;

export const modelCatalog = {
  fable: {
    alias: "fable" as const,
    apiId: "claude-fable-5",
    role: "consultant",
  },
  sonnet: {
    alias: "sonnet" as const,
    apiId: "claude-sonnet-4-6",
    role: "specialist",
  },
} as const;

export type ModelAlias = keyof typeof modelCatalog;
