# Worker Dashboard Foundation

## Source of truth

This build unit follows the canonical Phase 1 master specification dated 1 August 2026. It is a clean rebuild and does not treat the earlier prototype as an architectural dependency.

## Implemented contract

### Route and session boundary

- `/worker/login` accepts only the worker authentication adapter.
- `/worker/dashboard` is protected by a server-side role-bound session check.
- The session contains exactly one role: `worker`.
- `Exit portal` returns to the public homepage without deleting the worker session.
- `Sign out` deletes the worker session and returns to worker login.
- The application does not expose a role switcher.

### Dashboard projection

The page consumes one `WorkerDashboardProjection`. The projection deliberately includes the complete dashboard categories required by the master specification:

- Worker ID and identity status
- profile completion
- current company and employment link
- qualification and evidence status
- assessment availability and current assessment status
- company assignment and funding status
- Assurance Case timeline and explicit next-action ownership
- upcoming interview
- credentials and expiry
- reassessment eligibility
- appeals
- notifications
- payments

The initial repository implementation provides two adapters:

1. a safe empty projection for environments without persistence;
2. an environment-gated, non-persistent demonstration projection for visual and workflow validation.

Neither adapter pretends to be production persistence.

### UX states

- Server-rendered data state
- legitimate empty state
- route loading state
- recoverable route error state with a correlation reference
- accessible focus states and live announcements
- responsive desktop, tablet and mobile portal layout
- no manual browser refresh required for navigation

### Working controls

- Copy Worker ID
- dashboard notification deep links
- safe public profile view when the projection explicitly permits it
- Exit portal
- Sign out

Controls for profile, evidence, assessments, interviews, credentials, appeals and payments are not rendered as active actions until their destination modules are implemented. This prevents decorative or dead controls.

## Security notes

The foundation login adapter is environment-gated and intended only for local or isolated review environments. It uses an HMAC-signed, HTTP-only, same-site worker session cookie and timing-safe credential/signature comparisons. Production must replace credential checking with the approved worker authentication provider while preserving the session and dashboard interfaces.

The UI is not the authorization boundary. The Worker Portal layout calls the server-side session requirement on every protected render.

## Next build units

The dashboard-by-dashboard sequence continues inside the Worker Portal:

1. Worker Profile and onboarding continuation
2. Identity submission and correction
3. Evidence: qualifications, experience, employment, skills and leaving letters
4. Assessment catalogue, assignment and status
5. Interview waiting room and schedule
6. Credentials, scoped share links and Living Record
7. Appeals, notifications, payments, privacy, security and accessibility

Each unit must add its own route, backend command/query contract, loading/success/failure states, authorization, audit behavior and tests before its dashboard action becomes active.
