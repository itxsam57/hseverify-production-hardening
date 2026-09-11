-- Restore the exact pre-0037 role shape if this corrective migration is rolled back.
-- The account remains disabled and noninteractive under M1.12's guards.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth_accounts
    WHERE account_id = 'account_public_concern_intake_system'
      AND account_status = 'disabled'
      AND password_hash IS NULL
  ) THEN
    RAISE EXCEPTION
      'Public concern service principal is unavailable for rollback.'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO auth_account_roles (account_id, role, created_at)
  VALUES ('account_public_concern_intake_system', 'root', CURRENT_TIMESTAMP)
  ON CONFLICT (account_id, role) DO NOTHING;
END;
$$;
