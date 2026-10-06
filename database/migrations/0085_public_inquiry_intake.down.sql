-- Preserve accepted inquiries and immutable audit vocabulary during rollback.
-- Reapply is idempotent; stopping intake does not erase business history.
SELECT 1;
