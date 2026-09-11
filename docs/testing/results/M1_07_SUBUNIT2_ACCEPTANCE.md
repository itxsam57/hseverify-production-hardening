# M1.07 Subunit 2 Acceptance

## Unit

**M1.07 — Worker Onboarding and Identity Engine**  
**Subunit 2 — Worker Identity Draft and Verified Contact Binding**

## Result

**ENGINEERING PASS — 10 August 2026**

No browser/owner test is required for this subunit because it introduces no browser-visible route or product surface.

## Exact evidence

- Implementation PR: `#59`
- Accepted exact head: `29350dd47b51471462e21cdebbe6f5b67ebc2c18`
- Exact-head engineering gate: `31378294472` — **PASS**
- Merge commit: `61bdbde805ac4e27ade7a9c787559ff87b2dfb9d`
- Merged-main engineering gate: `31378748392` — **PASS**

## Accepted behavior

- Identity personal facts belong to the current versioned identity record, not generic Worker Profile JSON.
- Partial drafts may contain legal/previous name, date of birth, nationality and residence while incomplete.
- Verified email and phone are not browser-editable identity authority. They are snapshotted from the live authenticated Worker account inside the transaction.
- SQL independently overwrites verified-contact fields from `auth_accounts`, so direct writes cannot promote forged contact values into verified identity evidence.
- Both email and phone must exist with verification timestamps before the identity draft can be saved/submitted under the frozen onboarding rule.
- Date of birth is exact-date validated and cannot be in the future.
- Draft edits use an independent optimistic `draft_revision`; they do not consume the S1 lifecycle `lock_version`.
- Submission remains a material, audited lifecycle transition and is rejected unless required personal facts and the current verified-contact snapshot are complete and current.
- Ordinary partial draft saves are revision-traceable but do not create immutable security-audit spam.
- Durable identity/contact history does not create a physical foreign-key dependency on rollback-owned authentication tables.
- S2 migration rollback is monotonic and deterministic, and personal/contact state survives PGlite close/reopen.
- Lower-layer S1 tests are pinned to migration `0015`, while the complete application/release gate continues to apply the entire migration stack.

## First candidate failure and root fix

The first S2 run `31378166032` failed before product tests because the S2 source checker required an exact lowercase documentation sentence while the migration comment used sentence capitalization. This was the existing REG-061 prose-coupling class, not a product defect. The checker was changed to verify the policy semantically/case-insensitively; production migration text was not altered to satisfy a magic string.

## Next gate

Subunit 2 is closed only after this closure branch itself passes the full exact-head gate, merges with an expected-head SHA lock, and the resulting `main` commit passes the full engineering gate.

After that, **Subunit 3 — Secure Identity Document, Profile Photo and Selfie Evidence Binding** is the only permitted next internal unit. M1.08 and later bricks remain blocked.
