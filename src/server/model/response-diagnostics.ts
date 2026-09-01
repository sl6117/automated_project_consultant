// Structured-output response diagnostics. A billed response can still fail
// the Zod gate — truncated JSON at the max_tokens ceiling, a plain-text
// refusal, a quoted-string root, or malformed JSON — and those cases are
// indistinguishable once the payload alone reaches validation. The live
// clients therefore attach what the response itself said, and the
// validation boundary folds it into the error message, so a failed live
// window states its own cause instead of an opaque "expected object,
// received string".
//
// Diagnostics carry NO response content: the live consultant serves real
// private consultations, and an exception message travels into terminal
// output, server logs, and UI error paths. Stop reason, parse status,
// response length, and the JSON root type classify every observed failure
// without echoing a single character of what the model said.

export type ResponseDiagnostics = {
  // The provider's stop_reason, verbatim; null when the response omitted it.
  stopReason: string | null;
  // Whether the response text parsed as JSON at all.
  parsedAsJson: boolean;
  // Length of the raw response text in characters (content-free size signal:
  // a truncated response typically sits near the token ceiling, a refusal is
  // typically short).
  textLength: number;
  // The JSON root type when parseable ("object", "array", "string",
  // "number", "boolean", "null"); null when the text did not parse.
  jsonRootType: string | null;
};

export function buildDiagnostics(
  text: string,
  stopReason: string | null | undefined,
  parsedAsJson: boolean,
  payload: unknown,
): ResponseDiagnostics {
  return {
    stopReason: stopReason ?? null,
    parsedAsJson,
    textLength: text.length,
    jsonRootType: !parsedAsJson
      ? null
      : payload === null
        ? "null"
        : Array.isArray(payload)
          ? "array"
          : typeof payload,
  };
}

// Classifies a validation failure using the response metadata. Called only
// after the Zod gate has already rejected the payload; the returned sentence
// is appended to the validation error, never replacing it.
export function describeStructuredOutputFailure(
  diagnostics: ResponseDiagnostics,
): string {
  const shape = `${diagnostics.textLength} chars, json root ${diagnostics.jsonRootType ?? "n/a"}`;
  if (diagnostics.stopReason === "max_tokens") {
    return `response truncated at the max_tokens ceiling (stop_reason=max_tokens, ${shape}); JSON is incomplete`;
  }
  if (diagnostics.stopReason === "refusal") {
    return `model refused and returned plain text (stop_reason=refusal, ${shape})`;
  }
  if (!diagnostics.parsedAsJson) {
    return `response text is not valid JSON (stop_reason=${diagnostics.stopReason ?? "(none)"}, ${shape})`;
  }
  if (diagnostics.jsonRootType !== "object") {
    return `response parsed to a JSON ${diagnostics.jsonRootType} root, not an object (stop_reason=${diagnostics.stopReason ?? "(none)"}, ${shape})`;
  }
  return `payload failed validation despite parsing as a JSON object (stop_reason=${diagnostics.stopReason ?? "(none)"}, ${shape})`;
}

export function appendDiagnostics(
  error: unknown,
  diagnostics: ResponseDiagnostics | undefined,
): void {
  if (!diagnostics || !(error instanceof Error)) {
    return;
  }
  error.message = `${error.message} [structured-output diagnostics: ${describeStructuredOutputFailure(diagnostics)}]`;
}
