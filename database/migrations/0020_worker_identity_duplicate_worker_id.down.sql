-- M1.07 Subunit 5 owns immutable duplicate/recovery history and permanent Worker IDs.
-- Rollback is deliberately logical/monotonic: schema and durable history remain in
-- place so an older local/test release cannot erase identity eligibility evidence
-- or reissue a different permanent Worker ID. Removing the migration-ledger row
-- and reapplying this idempotent migration is the supported compatibility check.
SELECT 1;
