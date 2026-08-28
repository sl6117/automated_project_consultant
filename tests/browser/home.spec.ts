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

// The recorded extraction proposes exactly two statements and two concerns.
async function clearReview(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(page.getByLabel("Statement text")).toHaveCount(1);
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(page.getByLabel("Statement text")).toHaveCount(0);
  await page.getByRole("button", { name: "Approve concern" }).first().click();
  await expect(page.getByLabel("Concern coverage")).toHaveCount(1);
  await page.getByRole("button", { name: "Approve concern" }).first().click();
  await expect(page.getByLabel("Concern coverage")).toHaveCount(0);
}

async function askNextQuestion(page: import("@playwright/test").Page) {
  await clearReview(page);
  await page.getByRole("button", { name: "Ask next question" }).click();
  // The question body also appears in the candidate table, so wait on the
  // answer form instead — it exists only when a question is pending.
  await expect(page.getByLabel("Answer")).toBeVisible();
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

test("start renders recorded proposals and defers the first question", async ({
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
  await expect(page.getByText(/Model spend: \$0\.0000 used of \$5\.0000 cap/)).toBeVisible();
  await expect(
    page.getByText("Nothing approved yet. Exports will not include proposals."),
  ).toBeVisible();

  // No question exists at start; review must be cleared first.
  await expect(
    page.getByText("Who captures incoming household tasks today"),
  ).toHaveCount(0);
  await expect(
    page.getByText("Review every proposed statement and concern above"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ask next question" }),
  ).toHaveCount(0);
});

test("clearing review unlocks the next question from approved state", async ({
  page,
}) => {
  await startConsultation(page, "Question flow", "A box for household tasks");

  await askNextQuestion(page);

  await expect(page.getByText("Why this question:")).toBeVisible();
  // why_selected is the rubric's explanation, not the model's prose.
  await expect(page.getByText(/Rubric winner with effective total/)).toBeVisible();
  // "Question provenance" is distinct from the coach note's "Provenance"
  // label, so this stays unambiguous even when a coach note is on screen.
  await expect(
    page.getByText("Question provenance: model-inference"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ask next question" }),
  ).toHaveCount(0);
});

test("the candidate table shows claimed vs effective scores and both ranks", async ({
  page,
}) => {
  await startConsultation(page, "Rubric view", "A box for household tasks");
  await askNextQuestion(page);

  await expect(
    page.getByText("Candidate ranking (claimed vs effective)"),
  ).toBeVisible();
  await expect(
    page.getByText("The rubric disagreed with the model's order."),
  ).toBeVisible();

  // The winner row: model rank 2, rubric rank 1, claimed 1/2/0 → effective
  // 3/2/0 because workflow is a missing core code.
  const winnerRow = page.locator("tr").filter({ hasText: "Who captures" });
  await expect(winnerRow.getByText("1/2/0")).toBeVisible();
  await expect(winnerRow.getByText("3/2/0")).toBeVisible();
  await expect(winnerRow.getByText("#2", { exact: true })).toBeVisible();
  // The losing candidate persists and is visible too.
  await expect(
    page.locator("tr").filter({ hasText: "shared family accounts" }),
  ).toHaveCount(1);
});

test("the coverage checklist marks missing core codes as blocking", async ({
  page,
}) => {
  await startConsultation(page, "Coverage view", "A box for household tasks");

  await expect(page.getByText("Concern coverage checklist")).toBeVisible();
  // Before review, nothing is approved: all four core codes block.
  await expect(page.getByText("blocking")).toHaveCount(4);

  await clearReview(page);
  // The fixture approves user and non-goals coverage: user unblocks,
  // problem/workflow/success still block.
  await expect(page.getByText("blocking")).toHaveCount(3);
  await expect(page.getByText("✓ user")).toBeVisible();
  await expect(page.getByText("✓ non-goals")).toBeVisible();
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

test("answering stores the answer and yields incremental proposals to review", async ({
  page,
}) => {
  await startConsultation(page, "Capture box", "one household inbox");
  await askNextQuestion(page);

  await page.getByLabel("Answer").fill(
    "A daily list of tasks captured from one inbox.",
  );
  await page.getByRole("button", { name: "Record answer" }).click();

  // The answer is stored on the question — and only there: no statement was
  // auto-approved from it.
  await expect(
    page.getByText("A daily list of tasks captured from one inbox."),
  ).toHaveCount(1);
  await expect(page.getByText("Answer provenance: user")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record answer" })).toHaveCount(
    0,
  );
  await expect(
    page
      .locator("ul.list-disc")
      .getByText("A daily list of tasks captured from one inbox."),
  ).toHaveCount(0);

  // Sonnet's incremental proposals arrive for review.
  await expect(page.getByLabel("Statement text")).toHaveCount(1);
  await expect(page.getByLabel("Statement text").first()).toHaveValue(
    /one shared inbox and triaged daily/,
  );
  await expect(page.getByLabel("Concern coverage")).toHaveCount(3);

  // Approving the proposal is what moves it into the canonical ledger.
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(
    page
      .locator("ul.list-disc")
      .getByText("Tasks are captured into one shared inbox and triaged daily."),
  ).toBeVisible();
});

test("a blank answer shows a readable error and mutates nothing", async ({
  page,
}) => {
  await startConsultation(page, "Blank answer", "one household inbox");
  await askNextQuestion(page);

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
  // No decision was recorded from the blank answer.
  await expect(page.getByText("decision:")).toHaveCount(0);
});

test("mark the next question unknown records that disposition", async ({
  page,
}) => {
  await startConsultation(page, "Unknown path", "not sure who operates this");
  await askNextQuestion(page);

  await page.getByRole("button", { name: "Mark unknown" }).click();

  // The disposition lives on the resolved question; no statement is
  // auto-approved from it anymore.
  await expect(page.getByText("unknown", { exact: true })).toBeVisible();
  await expect(page.getByText("Answer provenance: user")).toBeVisible();
  await expect(page.locator("ul.list-disc").getByText("unknown:")).toHaveCount(
    0,
  );
});

test("the ready offer waits for the dismissed tension; confirming frames without locking", async ({
  page,
}) => {
  await startConsultation(page, "Framing flow", "one household inbox");
  await askNextQuestion(page);

  // The recorded Fable payload surfaced one tension citing the two approved
  // statements from extraction.
  await expect(
    page.getByText("The inbox is treated as the settled foundation"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dismiss tension" }),
  ).toBeVisible();

  // Answer the question, then approve the incremental proposals: one decision
  // and coverage for workflow, problem, and success.
  await page
    .getByLabel("Answer")
    .fill("A daily list of tasks captured from one inbox.");
  await page.getByRole("button", { name: "Record answer" }).click();
  await expect(page.getByLabel("Statement text")).toHaveCount(1);
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(page.getByLabel("Statement text")).toHaveCount(0);
  for (const remaining of [2, 1, 0]) {
    await page.getByRole("button", { name: "Approve concern" }).first().click();
    await expect(page.getByLabel("Concern coverage")).toHaveCount(remaining);
  }

  // Four checklist items pass, but the open tension withholds the offer —
  // Fable's advice has no say either way.
  await expect(page.getByText("✗ No open tensions")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm first slice is framed" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Dismiss tension" }).click();

  // The checklist now passes; the dismissed tension stays as provenance.
  await expect(page.getByText("1 closed tension kept as provenance")).toBeVisible();
  const confirmButton = page.getByRole("button", {
    name: "Confirm first slice is framed",
  });
  await expect(confirmButton).toBeVisible();
  await confirmButton.click();

  await expect(page.getByText(/First slice framed at /)).toBeVisible();
  // Confirming does not lock the session: asking remains available.
  await expect(
    page.getByRole("button", { name: "Ask next question" }),
  ).toBeVisible();
});

test("coaching shows the recorded note without touching approved state", async ({
  page,
}) => {
  await startConsultation(page, "Coach request", "one household inbox");
  await askNextQuestion(page);

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
  // Unpromoted coaching stays out of the approved ledger list.
  await expect(
    page
      .locator("ul.list-disc")
      .getByText("Start with a single shared capture inbox"),
  ).toHaveCount(0);
});

test("promoting a coach note records it as an approved user decision", async ({
  page,
}) => {
  await startConsultation(page, "Coach promote", "one household inbox");
  await askNextQuestion(page);
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
  await askNextQuestion(page);
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
