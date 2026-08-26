import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// The Playwright web server runs with CONSULTANT_MODEL_MODE=recorded, so the
// model boundary always returns tests/fixtures/phase-1 payloads regardless of
// what the test types. Project name and idea are user-provenance fields and do
// echo the input; statement/concern/question content comes from the fixtures.

async function startConsultation(
  page: import("@playwright/test").Page,
  name: string,
  idea: string,
) {
  await page.goto("/");
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Rough idea").fill(idea);
  await page.getByRole("button", { name: "Start consultation" }).click();
  await expect(page.locator("h1")).toContainText(name);
}

test("home page shows the start form", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText(
    "Automated Project Consultant",
  );
  await expect(
    page.getByRole("status").filter({
      hasText: "Local storage does not mean local inference",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Project name")).toBeVisible();
  await expect(page.getByLabel("Rough idea")).toBeVisible();
});

test("start renders recorded proposals, concerns, and the next question", async ({
  page,
}) => {
  await startConsultation(page, "Life Admin Inbox", "A box for household tasks");

  await expect(page.getByText("A box for household tasks")).toBeVisible();
  await expect(page.getByLabel("Statement text")).toHaveCount(2);
  await expect(page.getByLabel("Statement text").first()).toHaveValue(
    /household life-admin inbox/,
  );
  await expect(page.getByLabel("Concern coverage")).toHaveCount(2);
  await expect(page.getByLabel("Concern coverage").first()).toHaveValue(
    /single household operator/,
  );
  await expect(
    page.getByRole("heading", { name: "Approved ledger statements" }),
  ).toBeVisible();
  await expect(
    page.getByText("Nothing approved yet. Exports will not include proposals."),
  ).toBeVisible();
  await expect(
    page.getByText("Who captures incoming household tasks today"),
  ).toBeVisible();
  await expect(page.getByText("Why this question:")).toBeVisible();
  await expect(page.getByText("Provenance: model-inference")).toBeVisible();
});

test("model content comes from the fixture, not an echo of the idea", async ({
  page,
}) => {
  await startConsultation(
    page,
    "Ramen ops",
    "ramen restaurant inventory and budget manager",
  );

  await expect(
    page.getByText("ramen restaurant inventory and budget manager", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Statement text").first()).toHaveValue(
    /household life-admin inbox/,
  );
  await expect(page.getByText("Working title: Ramen ops")).toHaveCount(0);
});

test("a long rough idea stays in the textarea without leaving the page", async ({
  page,
}) => {
  const idea = "ramen inventory ".repeat(80);
  await page.goto("/");
  await page.getByLabel("Project name").fill("Ramen ops");
  await page.getByLabel("Rough idea").fill(idea);

  await expect(page).toHaveURL("/");
  await expect(page.getByLabel("Rough idea")).toHaveValue(idea);
  await expect(page.locator("h1")).toContainText(
    "Automated Project Consultant",
  );
});

test("approve moves a proposal into approved ledger statements", async ({
  page,
}) => {
  await startConsultation(page, "Approve flow", "A box for household tasks");

  await page.getByRole("button", { name: "Approve", exact: true }).first().click();

  await expect(
    page.getByText("The user wants a household life-admin inbox"),
  ).toBeVisible();
  await expect(
    page.getByText("Nothing approved yet. Exports will not include proposals."),
  ).toHaveCount(0);
  await expect(page.getByLabel("Statement text")).toHaveCount(1);
});

test("reject removes a proposal without approving it", async ({ page }) => {
  await startConsultation(page, "Reject flow", "A box for household tasks");

  const card = page.locator("li").filter({ hasText: "hypothesis" });
  await expect(card.getByLabel("Statement text")).toHaveValue(
    /Triage once per day/,
  );
  await card.getByRole("button", { name: "Reject", exact: true }).click();

  await expect(page.locator("li").filter({ hasText: "hypothesis" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Statement text")).toHaveCount(1);
  await expect(page.getByText("Triage once per day")).toHaveCount(0);
  await expect(
    page.getByText("Nothing approved yet. Exports will not include proposals."),
  ).toBeVisible();
});

test("edit approves the user's wording in place of the proposal", async ({
  page,
}) => {
  await startConsultation(page, "Edit flow", "A box for household tasks");

  const statement = page.getByLabel("Statement text").first();
  await statement.fill("The user wants one inbox for all household admin.");
  await page.getByRole("button", { name: "Save edit" }).first().click();

  await expect(
    page.getByText("The user wants one inbox for all household admin."),
  ).toBeVisible();
  await expect(page.getByLabel("Statement text")).toHaveCount(1);
  await expect(
    page.getByText("Nothing approved yet. Exports will not include proposals."),
  ).toHaveCount(0);
});

test("approve a concern coverage claim", async ({ page }) => {
  await startConsultation(page, "Concern flow", "A box for household tasks");

  await page.getByRole("button", { name: "Approve concern" }).first().click();

  await expect(
    page.getByText("A single household operator capturing tasks"),
  ).toBeVisible();
  await expect(page.getByLabel("Concern coverage")).toHaveCount(1);
  await expect(
    page.getByText("No concern coverage approved yet."),
  ).toHaveCount(0);
});

test("record an answer as an approved decision with user provenance", async ({
  page,
}) => {
  await startConsultation(page, "Capture box", "one household inbox");

  await page.getByLabel("Answer").fill(
    "A daily list of tasks captured from one inbox.",
  );
  await page.getByRole("button", { name: "Record answer" }).click();

  await expect(
    page.getByText("A daily list of tasks captured from one inbox."),
  ).toHaveCount(2);
  await expect(page.getByText("decision:")).toBeVisible();
  await expect(page.getByText("Answer provenance: user")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record answer" })).toHaveCount(
    0,
  );
});

test("a blank answer shows a readable error and mutates nothing", async ({
  page,
}) => {
  await startConsultation(page, "Blank answer", "one household inbox");

  // Whitespace passes the browser's `required` check, so this exercises the
  // server-side validation path and its action-state error.
  await page.getByLabel("Answer").fill("   ");
  await page.getByRole("button", { name: "Record answer" }).click();

  await expect(
    page.getByRole("alert").filter({
      hasText: "Type an answer before recording it",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Record answer" })).toBeVisible();
  await expect(
    page.getByText("Nothing approved yet. Exports will not include proposals."),
  ).toBeVisible();
});

test("mark the next question unknown records that disposition", async ({
  page,
}) => {
  await startConsultation(page, "Unknown path", "not sure who operates this");

  await page.getByRole("button", { name: "Mark unknown" }).click();

  await expect(page.locator("ul.list-disc").getByText("unknown:")).toBeVisible();
  await expect(page.getByText("Answer provenance: user")).toBeVisible();
});

test("coaching shows the recorded note without touching approved state", async ({
  page,
}) => {
  await startConsultation(page, "Coach request", "one household inbox");

  await page.getByRole("button", { name: "Get coaching" }).click();

  await expect(
    page.getByText(
      "Start with a single shared capture inbox before building any automation.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Confidence: medium")).toBeVisible();
  await expect(
    page.getByText("Evidence that would change this"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Promote to decision" }),
  ).toBeVisible();
  await expect(
    page.getByText("Nothing approved yet. Exports will not include proposals."),
  ).toBeVisible();
});

test("promoting a coach note records it as an approved user decision", async ({
  page,
}) => {
  await startConsultation(page, "Coach promote", "one household inbox");
  await page.getByRole("button", { name: "Get coaching" }).click();

  await page.getByRole("button", { name: "Promote to decision" }).click();

  await expect(
    page
      .locator("ul.list-disc")
      .getByText(
        "Start with a single shared capture inbox before building any automation.",
      ),
  ).toBeVisible();
  await expect(page.getByText("· Promoted")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Promote to decision" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Nothing approved yet. Exports will not include proposals."),
  ).toHaveCount(0);
});

test("export is blocked until a statement is approved", async ({ page }) => {
  await startConsultation(page, "Export gate", "one household inbox");

  await page.getByRole("button", { name: "Generate export" }).click();

  await expect(
    page.getByRole("alert").filter({
      hasText: "Approve at least one statement before generating an export",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "SPEC.md" })).toHaveCount(0);
});

test("a downloaded export contains approved state and no unpromoted coaching", async ({
  page,
}) => {
  await startConsultation(page, "Export flow", "one household inbox");
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await page.getByRole("button", { name: "Get coaching" }).click();
  await expect(
    page.getByText(
      "Start with a single shared capture inbox before building any automation.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Generate export" }).click();
  const specLink = page.getByRole("link", { name: "SPEC.md" });
  await expect(specLink).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await specLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("SPEC.md");

  const path = await download.path();
  const body = readFileSync(path, "utf8");
  expect(body).toContain("The user wants a household life-admin inbox");
  expect(body).not.toContain(
    "Start with a single shared capture inbox before building any automation.",
  );
});

test("downloads serve the persisted snapshot and refuse foreign lookups", async ({
  page,
}) => {
  await startConsultation(page, "Snapshot flow", "one household inbox");
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await page.getByRole("button", { name: "Generate export" }).click();

  const assumptionsLink = page.getByRole("link", { name: "ASSUMPTIONS.md" });
  await expect(assumptionsLink).toBeVisible();
  const href = await assumptionsLink.getAttribute("href");
  if (!href) {
    throw new Error("Expected a download href");
  }

  // Mutate the ledger after the snapshot: approve the remaining hypothesis,
  // which a fresh compile would list under assumptions.
  const card = page.locator("li").filter({ hasText: "hypothesis" });
  await card.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page
      .locator("ul.list-disc")
      .getByText("Triage once per day is enough if capture is reliable."),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await assumptionsLink.click();
  const download = await downloadPromise;
  const body = readFileSync(await download.path(), "utf8");
  expect(body).toContain("No approved assumptions yet.");
  expect(body).not.toContain("Triage once per day");

  // Unknown version id and a version id under the wrong session both 404.
  const sessionPath = href.slice(0, href.lastIndexOf("/artifacts/"));
  const missing = await page.request.get(`${sessionPath}/artifacts/missing-id`);
  expect(missing.status()).toBe(404);
  const foreign = await page.request.get(
    href.replace(sessionPath, "/sessions/some-other-session"),
  );
  expect(foreign.status()).toBe(404);
});
