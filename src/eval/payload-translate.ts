import type { CanonicalIdMap } from "./request-hash";

// Next-question payloads cite approved-statement ids that exist only in the
// session that produced them. Recordings therefore store payloads in
// canonical-id form (translated with the SAME first-appearance numbering the
// request hash used), and replay translates them back onto the replay
// session's fresh UUIDs. The translation is schema-aware like the request
// canonicalization: only contradictions[].citedStatementIds — the one payload
// field defined as carrying statement ids — is touched, and only ids that
// appear in the map are rewritten. An id the model invented stays verbatim,
// so a recorded validation failure reproduces as the same validation failure
// on replay. Extraction, incremental, and coach payloads carry no ids and
// pass through untouched.

function translateCitedIds(
  payload: unknown,
  translate: (id: string) => string,
): unknown {
  if (payload === null || typeof payload !== "object") {
    return payload;
  }
  const envelope = payload as Record<string, unknown>;
  const inner = envelope["payload"];
  if (
    envelope["task"] !== "next_question" ||
    inner === null ||
    typeof inner !== "object"
  ) {
    return payload;
  }
  const contradictions = (inner as Record<string, unknown>)["contradictions"];
  if (!Array.isArray(contradictions)) {
    return payload;
  }
  return {
    ...envelope,
    payload: {
      ...(inner as Record<string, unknown>),
      contradictions: contradictions.map((entry) => {
        if (entry === null || typeof entry !== "object") {
          return entry;
        }
        const cited = (entry as Record<string, unknown>)["citedStatementIds"];
        if (!Array.isArray(cited)) {
          return entry;
        }
        return {
          ...(entry as Record<string, unknown>),
          citedStatementIds: cited.map((id) =>
            typeof id === "string" ? translate(id) : id,
          ),
        };
      }),
    },
  };
}

// Capture direction: session UUIDs -> canonical tokens.
export function payloadToCanonical(
  payload: unknown,
  ids: CanonicalIdMap,
): unknown {
  return translateCitedIds(payload, (id) => ids.statements.get(id) ?? id);
}

// Replay direction: canonical tokens -> this replay session's UUIDs.
export function payloadFromCanonical(
  payload: unknown,
  ids: CanonicalIdMap,
): unknown {
  const inverse = new Map(
    [...ids.statements].map(([uuid, canonical]) => [canonical, uuid]),
  );
  return translateCitedIds(payload, (id) => inverse.get(id) ?? id);
}
