# M1.07 Subunit 3 Regression Record

## REG-075 — S3 runtime fixture bypassed the accepted M1.06 scan-job binding

**Class:** test-architecture regression discovered by the complete exact-head gate.

### Reproduction

The first S3 exact-head run `31383684472` on `a502f1012015f4e3e8bd7481e78258c1de6eb321` reached the new real PGlite evidence suite after all accepted M1.01–M1.06 and M1.07 S1/S2 checks had passed. The S3 fixture attempted to manufacture an `available` secure file by writing `quarantined -> scan_pending` without the accepted M1.06 generation/outbox binding. The existing database guard correctly rejected the transition with `Secure file initial scan binding is invalid.`

A second fixture defect derived phone numbers from suffix length, which let two same-length Worker fixture names collide with the accepted `auth_accounts.phone_e164` uniqueness boundary.

### Root cause

The S3 tests treated an accepted upstream state (`available` secure evidence) as a convenient fixture value rather than constructing the prerequisite through the upstream domain invariants that give the state its meaning. That would have allowed future S3 tests to stop proving compatibility with the real M1.06 scan boundary.

### Root fix

- S3 secure-file fixtures now create the required pending `secure_file.scan` outbox job with exact Worker scope and `{ fileRef, generation: 1 }` payload before the database may enter `scan_pending`.
- The fixture then binds `scan_generation = 1` and the exact `scan_job_id`; only afterward can the accepted M1.06 guard move the file to `available` with result code `clean`.
- Multi-Worker fixtures now allocate deterministic unique verified phone values rather than deriving uniqueness from string length.
- The existing M1.06 guards were not weakened or bypassed.

### Permanent guard

`scripts/check-worker-identity-evidence.mjs` must require the S3 platform and migration fixtures to retain the real scan outbox/job/generation binding markers. The complete application gate must continue running the accepted M1.06 suites before S3 and the S3 runtime suite itself.

This regression is a test-harness defect, not a production M1.06 defect. The accepted M1.06 database boundary behaved correctly and prevented the bad fixture from masking an invalid secure-file lifecycle.
