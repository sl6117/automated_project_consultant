import { describe, expect, test, vi, beforeEach } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import { describeNextQuestionRequest } from "../../../src/server/model/prompt";

vi.mock("../../../src/server/ledger/model-attempts", () => ({
  beginModelAttempt: vi.fn(),
  settleModelAttempt: vi.fn(),
}));

import {
  beginModelAttempt,
  settleModelAttempt,
} from "../../../src/server/ledger/model-attempts";
import {
  ModelTransportError,
  runModelAttempt,
} from "../../../src/server/model/attempt-runner";

const begin = vi.mocked(beginModelAttempt);
const settle = vi.mocked(settleModelAttempt);

const FAKE_ATTEMPT = {
  id: "attempt-1",
  estimated_cost_microcents: 123_456,
} as ReturnType<typeof beginModelAttempt>;

function runInput(overrides: {
  invoke?: () => Promise<{ payload: unknown; usage: null }>;
  parse?: (payload: unknown) => unknown;
}) {
  return {
    db: openMemoryLedger(),
    sessionId: "s1",
    alias: "fable" as const,
    executionProvenance: "recorded" as const,
    request: describeNextQuestionRequest({ idea: "x", projectName: "y" }),
    invoke:
      overrides.invoke ?? (async () => ({ payload: { ok: true }, usage: null })),
    parse: overrides.parse ?? ((payload: unknown) => payload),
  };
}

beforeEach(() => {
  begin.mockReset();
  settle.mockReset();
  begin.mockReturnValue(FAKE_ATTEMPT);
  settle.mockImplementation(
    (_db, input) =>
      ({ ...FAKE_ATTEMPT, status: input.outcome }) as ReturnType<
        typeof settleModelAttempt
      >,
  );
});

describe("runModelAttempt", () => {
  test("a transport failure settles without an actual cost, keeping the estimate reserved", async () => {
    await expect(
      runModelAttempt(
        runInput({
          invoke: async () => {
            throw new Error("timeout");
          },
        }),
      ),
    ).rejects.toThrow(ModelTransportError);

    expect(settle).toHaveBeenCalledTimes(1);
    const [, settleInput] = settle.mock.calls[0]!;
    expect(settleInput.outcome).toBe("transport_failed");
    // Unknown spend never becomes an actual: it stays reserved via the
    // estimate on the still-unsettled-actual row.
    expect("actualCostMicrocents" in settleInput).toBe(false);
  });

  test("a settlement failure propagates as itself, not as validation failure", async () => {
    settle.mockImplementation(() => {
      throw new Error("disk I/O error");
    });

    await expect(runModelAttempt(runInput({}))).rejects.toThrow(
      "disk I/O error",
    );

    // Exactly one settle call, for the succeeded outcome — never a second
    // attempt to relabel the database failure as validation_failed.
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0]![1].outcome).toBe("succeeded");
  });

  test("a parse failure settles validation_failed and rethrows the parse error", async () => {
    await expect(
      runModelAttempt(
        runInput({
          parse: () => {
            throw new Error("bad shape");
          },
        }),
      ),
    ).rejects.toThrow("bad shape");

    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0]![1].outcome).toBe("validation_failed");
    expect(settle.mock.calls[0]![1].actualCostMicrocents).toBe(0);
  });
});
