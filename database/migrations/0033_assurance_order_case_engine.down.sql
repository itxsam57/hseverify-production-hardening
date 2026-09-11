-- M2.01 is a monotonic history-bearing brick.
-- Assurance Orders, worker targets, cases, Action Centre items and append-only
-- timeline are retained during ledger rollback so a lower brick can be
-- independently repaired without erasing assurance history. Reapplying the up
-- migration is idempotent and reasserts all guards and indexes.
SELECT 1;
