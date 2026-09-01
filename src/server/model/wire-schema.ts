// Anthropic's structured-output validator supports only a subset of JSON
// Schema (evidenced live, 2026-08-31: maxItems, then integer minimum and
// maximum were each rejected with a 400 at the transport boundary). The
// full constraints stay in the prompt contract text and the Zod gates —
// which are the authoritative validation anyway — and this single
// transformation strips the unsupported keywords from every wire schema, so
// no schema author has to remember the subset and no future keyword slips
// through by hand.
//
// Unsupported on the wire (documented + evidenced): numeric
// minimum/maximum/multipleOf, string minLength/maxLength, maxItems, and
// minItems above 1 (minItems: 1 is tolerated — both live windows accepted
// it — and is clamped, not dropped, to keep the non-empty signal).
//
// Everything else must be AFFIRMATIVELY known-supported: a keyword on
// neither list throws here, at schema build time, so a future unsupported
// keyword fails locally in tests instead of reaching the API and burning a
// live window on a 400.

const STRIPPED_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
]);

const SUPPORTED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "anyOf",
  "minItems",
]);

export class UnknownSchemaKeywordError extends Error {
  constructor(keyword: string) {
    super(
      `Wire schema keyword "${keyword}" is neither known-supported nor known-stripped; verify it against the provider's documented subset and add it to the matching list in wire-schema.ts before it can reach the API`,
    );
    this.name = "UnknownSchemaKeywordError";
  }
}

export function toWireSchema<T>(schema: T): T {
  return walkSchema(schema) as T;
}

function walkSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(walkSchema);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "properties" && child !== null && typeof child === "object") {
      // Keys under "properties" are field NAMES, not schema keywords: a
      // field legitimately named "minimum" must survive; only its schema
      // value is walked.
      result[key] = Object.fromEntries(
        Object.entries(child as Record<string, unknown>).map(
          ([name, fieldSchema]) => [name, walkSchema(fieldSchema)],
        ),
      );
      continue;
    }
    if (STRIPPED_KEYWORDS.has(key)) {
      continue;
    }
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new UnknownSchemaKeywordError(key);
    }
    if (key === "minItems" && typeof child === "number") {
      result[key] = Math.min(child, 1);
      continue;
    }
    result[key] = walkSchema(child);
  }
  return result;
}
