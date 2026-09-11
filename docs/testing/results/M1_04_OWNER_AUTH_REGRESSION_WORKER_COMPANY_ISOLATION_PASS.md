# M1.04 Authorization Foundation — Worker/Company Isolation Regression PASS

Status: **OWNER PASS — SECTION G IN PROGRESS**

Owner test date: 4 August 2026

Environment:

- Windows 10
- Google Chrome
- Normal Command Prompt
- Development server: `http://localhost:3000`

Owner-confirmed result:

- an active Worker session could not cross into the Company portal;
- the Company dashboard was not displayed to the Worker session;
- the application required the Worker to sign out before Company authentication could proceed;
- no role switching or cross-portal session reuse occurred.

Verdict boundary:

Section G Worker-to-Company isolation is **PASS**.

Section G remains in progress only until a signed-out request to `/company/dashboard` is confirmed to redirect to `/company/login`, after which the development server must be stopped cleanly.
