import Anthropic from "@anthropic-ai/sdk";
import type { JudgeClient } from "./judge-client";

// Live Sonnet judge, mirroring the consultant live client: the request
// description is sent exactly as built, the key stays inside the SDK
// instance (never logged, persisted, or included in errors), and the payload
// stays unknown for the Zod gates to judge.

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
  usage?: SdkUsage;
};

export type JudgeSdk = {
  messages: { create(params: unknown): Promise<unknown> };
};

export function createLiveJudgeClient(
  options: { apiKey?: string; sdk?: JudgeSdk } = {},
): JudgeClient {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!options.sdk && !apiKey) {
    throw new Error(
      "Live judge capture requires ANTHROPIC_API_KEY in the environment",
    );
  }
  const sdk: JudgeSdk = options.sdk ?? new Anthropic({ apiKey });

  return {
    executionProvenance: "live",
    async judge(input) {
      const response = (await sdk.messages.create(
        input.request,
      )) as SdkResponse;
      const text = (response.content ?? [])
        .filter(
          (block) => block.type === "text" && typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("");
      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
      const write5m =
        response.usage?.cache_creation?.ephemeral_5m_input_tokens ??
        response.usage?.cache_creation_input_tokens ??
        0;
      return {
        payload,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
          cacheWrite5mTokens: write5m,
          cacheWrite1hTokens:
            response.usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0,
        },
      };
    },
  };
}
