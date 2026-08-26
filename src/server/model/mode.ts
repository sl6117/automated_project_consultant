import type { ModelClient } from "./client";
import { createRecordedModelClient } from "./recorded-client";
import { createStubModelClient } from "./stub-client";

export const supportedModelModes = ["stub", "recorded"] as const;
export type ModelMode = (typeof supportedModelModes)[number];

export function resolveModelClient(
  mode: string = process.env.CONSULTANT_MODEL_MODE ?? "stub",
): ModelClient {
  if (mode === "stub") {
    return createStubModelClient();
  }
  if (mode === "recorded") {
    return createRecordedModelClient();
  }
  throw new Error(
    `Unsupported CONSULTANT_MODEL_MODE "${mode}". Supported modes: ${supportedModelModes.join(", ")}.`,
  );
}
