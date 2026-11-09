-- CHECK constraints run while pg_restore intentionally has an empty search_path.
-- Pin only this validator's lookup context; retain the report body and all history.
ALTER FUNCTION public.hse_report_snapshot_valid(TEXT,JSONB,JSONB)
 SET search_path TO pg_catalog, public, pg_temp;
