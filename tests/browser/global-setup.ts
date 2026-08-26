import { rmSync } from "node:fs";
import { join } from "node:path";

// The app opens the ledger lazily on first request, so removing the file here
// (after the web server boots, before any test navigates) yields a fresh
// ledger per run. A reused warm server from a previous run keeps its handle to
// the unlinked file; the Playwright-launched server on port 3005 is always
// fresh, so this only matters if a stale server is reused deliberately.
export default function globalSetup(): void {
  rmSync(join(process.cwd(), "data", "playwright.sqlite"), { force: true });
}
