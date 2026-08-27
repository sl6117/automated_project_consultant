import { modelCatalog, type ModelAlias } from "./config";

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
};

export const EMPTY_USAGE: ModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
};

export function costOfUsageMicrocents(
  alias: ModelAlias,
  usage: ModelUsage,
): number {
  const pricing = modelCatalog[alias].pricing;
  return (
    usage.inputTokens * pricing.inputMicrocentsPerToken +
    usage.outputTokens * pricing.outputMicrocentsPerToken +
    usage.cacheReadTokens * pricing.cacheReadMicrocentsPerToken +
    usage.cacheWrite5mTokens * pricing.cacheWrite5mMicrocentsPerToken +
    usage.cacheWrite1hTokens * pricing.cacheWrite1hMicrocentsPerToken
  );
}

// Conservative pre-call estimate: it reserves budget before any network I/O,
// so it must be a true upper bound. It consumes the exact request description
// the SDK call will send — system blocks, rendered user message, output
// schema, and max tokens — serialized to UTF-8 bytes. A BPE token encodes at
// least one byte, so the byte count of the serialization bounds the token
// count from above (and covers non-ASCII input, labels, and schema framing).
// No cache discount is assumed; output is bounded by the request's max_tokens.
import type { ModelRequestDescription } from "./prompt";

export function estimateRequestCostMicrocents(
  alias: ModelAlias,
  request: ModelRequestDescription,
): number {
  const pricing = modelCatalog[alias].pricing;
  const inputTokens = Buffer.byteLength(JSON.stringify(request), "utf8");
  return (
    inputTokens * pricing.inputMicrocentsPerToken +
    request.max_tokens * pricing.outputMicrocentsPerToken
  );
}
