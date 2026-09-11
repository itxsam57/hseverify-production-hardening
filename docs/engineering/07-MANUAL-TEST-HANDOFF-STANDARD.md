# 07 — Manual Test Handoff Standard

## Purpose

The handoff tells the project owner when technical testing is complete and exactly what visible behaviour needs human acceptance.

## Required status

Use exactly one:

- `READY FOR MANUAL BROWSER TESTING`
- `NOT READY — AUTOMATED ENGINEERING GATE FAILED`
- `NO MANUAL FEATURE TEST REQUIRED`

## Required content

### Build information

- project;
- branch;
- commit;
- base branch or commit;
- preview/runnable link;
- automated-gate result.

### Requested change

A brief plain-language summary.

### Visible features changed

For each feature:

- feature name;
- affected role;
- what changed;
- why manual inspection is needed;
- risk: low, medium, or high.

### Exact manual tests

Use IDs such as `MAN-001`.

Each test includes:

- role/account;
- starting page;
- required test data;
- exact steps;
- expected visible result;
- expected persistence after refresh if relevant;
- related feature.

Avoid vague instructions such as “test the dashboard.”

### Regression spot-checks

List only areas plausibly affected through shared code, permissions, storage, navigation, database, or common components.

### Unaffected areas

List confidently unaffected major areas so the owner does not retest the whole product.

### Setup requirements

Include only applicable items: test account, sample file, browser permission, sandbox payment, seeded record, migration, feature flag, special URL, or device.

### Automated evidence

Concise PASS/FAIL/BLOCKED summary. Never paste complete logs.

## Change detection rules

Determine impact using:

- requested feature;
- actual code diff;
- dependency relationships;
- routes and APIs changed;
- schema and migration changes;
- shared components;
- authentication and middleware;
- tests changed;
- configuration changes.

Do not list a feature as changed only because a test file changed. Do not hide indirect impact from shared code.

## Example

```text
READY FOR MANUAL BROWSER TESTING

Preview: https://example-preview

Changed features:
- Worker document upload — Worker — Medium risk
- Evidence preview — Verifier — Medium risk

MAN-001
Role: Worker
Start: Documents
Steps: Upload the supplied PDF and submit it.
Expected: The document appears as Under Review without a full-page refresh.

MAN-002
Role: Verifier
Start: Pending Reviews
Steps: Open the submitted record and preview the file.
Expected: Correct worker name, document type, and file are shown.

Regression spot-check:
- Upload one PNG because the shared uploader changed.
```


---
