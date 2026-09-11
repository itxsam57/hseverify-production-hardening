# 04 — Security Standard

## Server-side enforcement

Hiding a button is not authorization. Every protected action and record read must be enforced at the trusted boundary: server, API, service, database policy, or operating-system permission layer.

Test direct URL access, direct API calls, changed identifiers, stale sessions, and cross-role attempts.

## Identity, roles, and tenants

Where applicable, verify:

- unauthenticated users cannot access protected resources;
- each role can access only its intended capabilities;
- a user cannot switch roles by editing a request or URL;
- tenant A cannot read or modify tenant B;
- records remain linked to the correct worker, company, reviewer, account, mailbox, creator, or project;
- logout invalidates access appropriately;
- expired, revoked, and malformed sessions are rejected;
- administrative actions are auditable.

## Sensitive data

Classify data in `PROJECT-PROFILE.md`.

Never place secrets or sensitive user content in:

- source control;
- test snapshots;
- screenshots;
- traces;
- videos;
- CI summaries;
- public preview environments;
- AI prompts;
- analytics or debug output.

Use redacted synthetic fixtures.

## Uploads and documents

When the project accepts files, test:

- allowed type and size;
- mismatched extension and content type;
- unsafe filename;
- unauthorized download;
- cross-tenant access;
- storage failure;
- duplicate upload;
- failed or interrupted upload;
- malware scanning boundary if present;
- retention and deletion rules;
- correct record association.

## Inputs and actions

Validate input on trusted boundaries. Protect against injection, unsafe redirects, path manipulation, cross-site request abuse, insecure object references, and excessive data exposure as applicable to the stack.

## External callbacks and webhooks

Verify authenticity, replay protection, idempotency, duplicate delivery, order changes, and partial failure.

## Security reporting

Do not publish exploitable details in public logs. Report enough to fix the issue while redacting secrets and user data.

A failed required security or isolation test always blocks manual handoff readiness.


---
