-- This table is a per-account mutex, not retained review/capacity history.
-- All immutable business/history foreign keys remain unchanged.
LOCK TABLE reviewer_capacity_locks IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conname='reviewer_capacity_locks_account_id_fkey'
   AND conrelid='reviewer_capacity_locks'::regclass
   AND confrelid='auth_accounts'::regclass
   AND contype='f' AND confdeltype='r'
 ) THEN
  RAISE EXCEPTION 'Unexpected reviewer capacity account lifecycle constraint';
 END IF;
END;
$$;
ALTER TABLE reviewer_capacity_locks DROP CONSTRAINT reviewer_capacity_locks_account_id_fkey;
ALTER TABLE reviewer_capacity_locks ADD CONSTRAINT reviewer_capacity_locks_account_id_fkey
 FOREIGN KEY(account_id) REFERENCES auth_accounts(account_id) ON DELETE CASCADE;
