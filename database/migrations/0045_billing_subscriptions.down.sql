-- Billing financial and provider journals are deliberately retained on ledger rollback.
-- Removing them would violate the append-only financial history guarantee.
SELECT 1;
