-- Monotonic security contract: never restore the unlocked 0026/0027
-- Company Team archived-unit assignment/invitation validators on rollback.
-- The migration ledger can roll back while this row-lock protection survives.
SELECT 1;
