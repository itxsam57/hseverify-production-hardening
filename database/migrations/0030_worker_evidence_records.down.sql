-- M1.11 Worker evidence history is monotonic. Rollback removes only the migration
-- ledger entry; accepted Worker evidence/history tables remain to prevent
-- destructive compliance loss.
SELECT 1;
