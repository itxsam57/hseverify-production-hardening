# Worker Dashboard Foundation Acceptance

## Required behavior

- A visitor without a valid Worker Portal session is redirected to `/worker/login`.
- The issued session contains only the `worker` role.
- No role-switching control exists.
- Cross-portal access cannot be granted by the Worker Dashboard UI.
- `Exit portal` returns to the public site without deleting the role-bound session.
- `Sign out` deletes the Worker Portal session.
- Worker ID copy reports success or failure accessibly.
- Public profile opens only when the server projection explicitly permits it.
- Notifications link to the exact dashboard section represented by the notification.
- Loading, data, empty and recoverable error states render without a manual refresh.
- The dashboard displays current action ownership rather than a generic processing message.
- Unimplemented destination modules do not appear as active decorative controls.

## Projection coverage

The projection contract contains identity, profile completion, company/employment link, evidence, assessments, company funding/assignment context, Assurance Cases and timeline, interview, credentials and expiry, reassessment, appeals, notifications and payments.

## Release gate

Run `npm run check`. All route-manifest, typecheck, lint and production-build steps must succeed before deployment.
