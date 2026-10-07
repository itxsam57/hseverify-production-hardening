# Optional sharing restriction

A Worker can request restriction of optional passport share links through Privacy. The server fixes the scope to optional sharing; required case processing, identity, evidence and audit history continue. An authorized Admin completes the request with a reason. Completion atomically revokes existing owned links and records the fulfilment marker in the existing request/review history. Completed restrictions prevent creation through the repository and API, including a tampered client; the Worker sharing form shows the restriction and disables creation.

Ownership includes the account reference and permanent Worker ID. Missing or ambiguous ownership fails closed. Creation and completion lock the account before changing links. Recipient access holds a conflicting shared account lock through signed-token validation, projection and access logging, reading the restriction after acquiring the lock. Access already returned before completion cannot be recalled. No private evidence is loaded for restricted recipient access.

Required review failure rolls back both link revocation and request completion. Repeated/stale review cannot rewrite history. Keep existing history and completed markers when restoring data or performing maintenance; do not clear restriction markers to recover sharing. This bounded operation has no lifting workflow. Broader processing restriction, correction, retention inquiry, lawful deletion and restriction lifting remain separate unfinished workflows.

Local native and browser fixtures verify the operation. Executed SQL proves the intended lock order; it does not certify real PostgreSQL contention. Production deployment verification remains required.
