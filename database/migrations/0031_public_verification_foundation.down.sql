-- M1.12 public concern intake is compliance/security history and remains monotonic.
-- Rollback removes only the migration ledger entry; retained tables allow a safe,
-- deterministic reapply without deleting received concerns or abuse history.
SELECT 1;