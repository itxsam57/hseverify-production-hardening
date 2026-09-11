# Worker Portal Isolation

The Worker Portal uses a server-validated session whose only role value is `worker`. The application contains no role-switch action. Protected Worker Portal layouts require that session on every render. `Exit portal` preserves the current role-bound session while returning to the public site; `Sign out` destroys it.

When other portals are introduced, each must use a separate login route and separate role-bound session validator. A Worker Portal session must never authorize company, reviewer, assessor, administrator or root-administrator routes.
