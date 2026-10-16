-- Signed supervisor evidence is immutable; acknowledgement is a single transition.
CREATE FUNCTION hse_supervisor_source_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Signed supervisor evidence is retained.' USING ERRCODE='55000'; END IF;
 IF (to_jsonb(NEW)-'observation_status'-'superseded_at') IS DISTINCT FROM (to_jsonb(OLD)-'observation_status'-'superseded_at') THEN
 RAISE EXCEPTION 'Signed supervisor evidence is immutable.' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER supervisor_source_immutable BEFORE UPDATE OR DELETE ON supervisor_observations FOR EACH ROW EXECUTE FUNCTION hse_supervisor_source_immutable();
CREATE FUNCTION hse_supervisor_detail_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Signed supervisor detail is retained.' USING ERRCODE='55000'; END IF;
 IF (to_jsonb(NEW)-'worker_acknowledged_at'-'worker_comment'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'worker_acknowledged_at'-'worker_comment'-'updated_at')
 OR OLD.worker_acknowledged_at IS NOT NULL OR NEW.worker_acknowledged_at IS NULL THEN
 RAISE EXCEPTION 'Signed source and acknowledgement are immutable.' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER supervisor_detail_immutable BEFORE UPDATE OR DELETE ON supervisor_observation_details FOR EACH ROW EXECUTE FUNCTION hse_supervisor_detail_immutable();
