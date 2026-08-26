"use client";

// Boundary for genuinely unexpected exceptions only. Expected domain failures
// (invalid input, stale reviews, invalid model output) are returned as action
// state and rendered inline by the forms, never thrown to this boundary.
export default function ErrorBoundary({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight">
        Something unexpected went wrong
      </h1>
      <p className="text-sm text-zinc-600">
        The request failed before completing. Ledger writes are transactional,
        so no partial changes were saved.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="w-fit rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
      >
        Try again
      </button>
    </main>
  );
}
