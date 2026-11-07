-- Preserve replacement provenance; an empty layer can be removed in dependency order.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM credential_replacements) THEN
    RAISE EXCEPTION 'Cannot roll back retained credential replacement history' USING ERRCODE='55000';
  END IF;
END; $$;
DROP TRIGGER credential_issuances_replacement_terminal ON credential_issuances;
DROP FUNCTION prevent_replaced_credential_reactivation();
DROP TABLE credential_replacements;
DROP FUNCTION validate_credential_replacement_provenance();
DROP FUNCTION retain_credential_replacement_event();
