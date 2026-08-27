import type { ModelClient } from "./client";
import { createLiveModelClient } from "./live-client";
import { createRecordedModelClient } from "./recorded-client";
import { createStubModelClient } from "./stub-client";

// stub: offline synthetic default. recorded: fixture playback for Playwright.
// live: real Anthropic calls, manual localhost use only — Vitest, Playwright,
// and CI never set it and never hold a key.
export function resolveModelClient(
  mode: string = process.env.CONSULTANT_MODEL_MODE ?? "stub",
): ModelClient {
  if (mode === "stub") {
    return createStubModelClient();
  }
  if (mode === "recorded") {
    return createRecordedModelClient();
  }
  if (mode === "live") {
    return createLiveModelClient();
  }
  throw new Error(
    `Unsupported CONSULTANT_MODEL_MODE: ${mode}. Use stub, recorded, or live.`,
  );
}
