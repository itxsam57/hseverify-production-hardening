# M1.07 Subunit 3 Design Guards

## Scope

Subunit 3 binds identity document, profile photo and selfie evidence to the current Worker identity version by reusing the accepted M1.06 secure-file domain.

## Permanent architecture guards

- Identity evidence stores an opaque `secure_file_id` plus identity metadata only. Raw bytes, base64, storage object keys, storage adapter details, hashes, reservation keys and signed access material stay inside M1.06.
- There is intentionally no physical foreign key from `worker_identity_evidence_bindings.secure_file_id` to `platform_secure_files`. M1.06 owns an accepted independent local/test rollback boundary; S3 validates the live secure-file row at binding and submission time without making immutable identity history own the storage table lifetime.
- A bind is valid only for the authenticated active Worker, the current editable identity version and an `available` M1.06 file owned by that same Worker with no tenant/membership scope.
- Profile photo and selfie bindings require a detected PNG/JPEG image.
- Exactly one active binding exists per identity version and purpose. Replacements preserve the previous binding as `superseded` with explicit lineage.
- Materially different replacements require the expected active binding ID. Exact retries are idempotent; stale edits fail instead of silently winning.
- Submitted evidence cannot be replaced or deleted. Corrections later create a new identity version and new evidence lineage rather than rewriting submitted history.
- Submission requires complete S2 personal/contact facts plus one current available identity document, profile photo and selfie. Provider/liveness outcomes remain S4 and are not invented here.
- S3 rollback is monotonic and history-preserving. Production destructive rollback remains prohibited by the migration runner.
- Draft evidence edits are represented by durable active/superseded evidence history. They do not add raw document numbers or file provenance to immutable platform audit metadata; the material identity submission transition remains audited.

## Live-test boundary

S3 introduces no browser-visible route or control. Owner/browser testing is therefore not a Subunit 3 gate. The genuine M1.07 live-test boundary remains Subunit 6 when `/worker/identity` is implemented.
