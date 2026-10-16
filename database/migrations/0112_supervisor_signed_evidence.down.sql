DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM supervisor_observation_details) THEN RAISE EXCEPTION 'Retained supervisor evidence blocks rollback.' USING ERRCODE='55000'; END IF;
END; $$;
DROP TRIGGER supervisor_detail_immutable ON supervisor_observation_details;
DROP TRIGGER supervisor_source_immutable ON supervisor_observations;
DROP FUNCTION hse_supervisor_detail_immutable();
DROP FUNCTION hse_supervisor_source_immutable();
