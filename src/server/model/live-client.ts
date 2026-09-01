import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelClientResult } from "./client";
import { buildDiagnostics } from "./response-diagnostics";
import type { ModelUsage } from "./pricing";
import type { ModelRequestDescription } from "./prompt";

// The narrow slice of the SDK the live client uses; tests inject a fake. The
// params are exactly the ModelRequestDescription the orchestrator estimated
// against — this client adds nothing and removes nothing.
export type MessagesSdk = {
  messages: {
    create(params: ModelRequestDescription): Promise<unknown>;
  };
};

type SdkUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
};

type SdkResponse = {
  content?: { type?: string; text?: string }[];
  stop_reason?: string | null;
  usage?: SdkUsage;
};

export function createLiveModelClient(
  options: { apiKey?: string; sdk?: MessagesSdk } = {},
): ModelClient {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!options.sdk && !apiKey) {
    throw new Error(
      "CONSULTANT_MODEL_MODE=live requires ANTHROPIC_API_KEY in the server environment",
    );
  }
  // The key stays inside the SDK instance: it is never logged, persisted, or
  // included in any error message.
  const sdk: MessagesSdk = options.sdk ?? new Anthropic({ apiKey });

  async function call(
    request: ModelRequestDescription,
  ): Promise<ModelClientResult> {
    const response = (await sdk.messages.create(request)) as SdkResponse;
    const { payload, text, parsedAsJson } = extractJsonPayload(response);
    return {
      payload,
      usage: mapUsage(response.usage),
      diagnostics: buildDiagnostics(
        text,
        response.stop_reason,
        parsedAsJson,
        payload,
      ),
    };
  }

  return {
    executionProvenance: "live",
    extractFromIdea(input) {
      return call(input.request);
    },
    nextQuestion(input) {
      return call(input.request);
    },
    incrementalExtraction(input) {
      return call(input.request);
    },
    coachRecommendation(input) {
      return call(input.request);
    },
  };
}

// The payload stays `unknown`: downstream Zod boundaries decide validity, and
// unparseable text is returned as-is so validation fails loudly rather than
// silently here — with the parse status preserved for the diagnostics.
function extractJsonPayload(response: SdkResponse): {
  payload: unknown;
  text: string;
  parsedAsJson: boolean;
} {
  const text = (response.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  try {
    return { payload: JSON.parse(text) as unknown, text, parsedAsJson: true };
  } catch {
    return { payload: text, text, parsedAsJson: false };
  }
}

function mapUsage(usage: SdkUsage | undefined): ModelUsage {
  // Older responses report only a combined cache_creation_input_tokens;
  // attribute it to the 5-minute tier, the default TTL.
  const write5m =
    usage?.cache_creation?.ephemeral_5m_input_tokens ??
    usage?.cache_creation_input_tokens ??
    0;
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWrite5mTokens: write5m,
    cacheWrite1hTokens: usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  };
}
