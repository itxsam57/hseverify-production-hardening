import assert from "node:assert/strict";

export async function bindGovernedReviewTask(page, baseUrl, {
  taskId,
  frameworkReference,
  policyReference,
  revisionValue = null,
  reason = "Explicit governed applicability for this queued evidence review."
}) {
  await page.goto(baseUrl + "/admin/review-frameworks", { waitUntil: "domcontentloaded" });
  const card = page.locator('section[aria-label="Framework for ' + taskId + '"]');
  await card.waitFor({ timeout: 15_000 });
  const revision = card.getByLabel("Review framework revision");
  let selected = revisionValue;
  if (!selected) {
    selected = await revision.locator("option").evaluateAll((items, ref) =>
      items.find((item) => item.value && (item.textContent ?? "").includes(String(ref)))?.value ?? null,
      frameworkReference
    );
  }
  assert(selected, "Authoritative review revision was unavailable.");
  await revision.selectOption(selected);
  const policy = card.getByLabel("Applicable published policy");
  if (await policy.count()) await policy.selectOption(policyReference);
  await card.getByLabel("Applicability reason").fill(reason);
  await card.getByRole("button", { name: "Bind review framework", exact: true }).click();
  await page.getByText("Review framework binding recorded.", { exact: true }).waitFor({ timeout: 15_000 });
  return selected;
}

export async function createGovernedReviewSetup(page, baseUrl, {
  taskId,
  verifierEmails,
  frameworkReference,
  policyReference,
  frameworkTitle,
  policyTitle
}) {
  await page.goto(baseUrl + "/admin/frameworks", { waitUntil: "domcontentloaded" });
  const frameworkForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Create framework" }) }).first();
  await frameworkForm.getByLabel("Reference", { exact: true }).fill(frameworkReference);
  await frameworkForm.getByLabel("Title", { exact: true }).fill(frameworkTitle);
  await frameworkForm.getByRole("button", { name: "Create framework" }).click();
  await page.getByText("Framework created.", { exact: true }).waitFor({ timeout: 15_000 });

  const policyForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Publish immutable version" }) }).first();
  await policyForm.getByLabel("Framework reference").fill(frameworkReference);
  await policyForm.getByLabel("Policy reference").fill(policyReference);
  await policyForm.getByLabel("Title", { exact: true }).fill(policyTitle);
  await policyForm.getByLabel("Effective from").fill("2026-01-01T00:00");
  await policyForm.getByLabel("Policy values JSON").fill('{"pass_mark":80,"max_attempts":2}');
  await policyForm.getByLabel("Override allowed fields JSON").fill('["pass_mark","max_attempts"]');
  await policyForm.getByLabel("Override directions JSON").fill('{"pass_mark":"MINIMUM","max_attempts":"MAXIMUM"}');
  await policyForm.getByRole("button", { name: "Publish immutable version" }).click();
  await page.getByText("Immutable policy version published.", { exact: true }).waitFor({ timeout: 15_000 });

  const revisionValue = await bindGovernedReviewTask(page, baseUrl, {
    taskId, frameworkReference, policyReference
  });

  for (const verifierEmail of verifierEmails) {
    await page.goto(baseUrl + "/admin/calibrations", { waitUntil: "domcontentloaded" });
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Record calibration" }) }).first();
    const staff = form.getByLabel("Staff member");
    const staffValue = await staff.locator("option").evaluateAll((items, email) =>
      items.find((item) => (item.textContent ?? "").toLowerCase().includes(String(email).toLowerCase()))?.value ?? null,
      verifierEmail
    );
    assert(staffValue, "Verifier was unavailable for calibration.");
    await staff.selectOption(staffValue);
    await form.getByLabel("Role").selectOption("verifier");
    await form.getByLabel("Framework reference").selectOption(frameworkReference);
    await form.getByLabel("Framework revision").selectOption(revisionValue);
    await form.getByLabel("Status").selectOption("CURRENT");
    // The framework revision is created with sub-second precision. Wait into a
    // later whole second before recording calibration so datetime-local never
    // truncates the start to a point before the authoritative revision.
    await page.waitForTimeout(1100);
    const calibrationStart = new Date();
    const setDateTimeLocal = async (locator, value) => locator.evaluate((input, next) => {
      input.value = next;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await setDateTimeLocal(form.getByLabel("Valid from"), calibrationStart.toISOString().slice(0, 19));
    await setDateTimeLocal(form.getByLabel("Valid until"), "2099-12-31T23:59:59");
    await form.getByLabel("Calibration evidence / note").fill("Observed benchmark calibration for this governed browser review journey.");
    await form.getByRole("button", { name: "Record calibration" }).click();
    await page.waitForFunction(() => location.pathname === "/admin/calibrations" && (location.search.includes("result=recorded") || location.search.includes("error=")), null, { timeout: 15_000 });
    if (page.url().includes("error=")) throw new Error(`Calibration setup failed: ${decodeURIComponent(page.url().split("error=")[1] ?? "")}`);
    await page.getByText("Calibration recorded.", { exact: true }).waitFor({ timeout: 15_000 });
  }
  return revisionValue;
}