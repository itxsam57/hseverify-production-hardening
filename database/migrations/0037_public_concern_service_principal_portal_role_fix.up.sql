-- Correct M1.12's non-login public concern service principal so it cannot
-- consume the one human Root bootstrap slot. The principal remains disabled,
-- passwordless, session-blocked and continues to use the trusted logical
-- secure-file owner role `root` through M1.12's dedicated authority path.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth_accounts
    WHERE account_id = 'account_public_concern_intake_system'
      AND email_normalized = 'public-concern-intake@system.hseverify.invalid'
      AND account_status = 'disabled'
      AND password_hash IS NULL
      AND phone_e164 IS NULL
      AND email_verified_at IS NULL
      AND phone_verified_at IS NULL
      AND worker_reference IS NULL
  ) THEN
    RAISE EXCEPTION
      'Public concern service principal is not in the expected noninteractive state.'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth_account_roles
    WHERE account_id = 'account_public_concern_intake_system'
      AND role <> 'root'
  ) THEN
    RAISE EXCEPTION
      'Public concern service principal has an unexpected portal role assignment.'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM auth_account_roles
  WHERE account_id = 'account_public_concern_intake_system'
    AND role = 'root';
END;
$$;
