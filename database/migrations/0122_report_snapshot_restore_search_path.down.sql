-- Configuration-only reversal; report rows and validation body remain intact.
DO $$ BEGIN
 IF (SELECT proconfig FROM pg_proc WHERE oid='public.hse_report_snapshot_valid(text,jsonb,jsonb)'::regprocedure)
    IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::TEXT[] THEN
  RAISE EXCEPTION 'Report validator lookup configuration changed; refusing rollback.';
 END IF;
END; $$;
ALTER FUNCTION public.hse_report_snapshot_valid(TEXT,JSONB,JSONB) RESET search_path;
