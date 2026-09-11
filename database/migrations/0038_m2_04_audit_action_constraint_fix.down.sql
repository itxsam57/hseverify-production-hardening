-- History-preserving compatibility migration.
-- Once M2.04 Question Bank audit rows exist, restoring the older action-key
-- constraint would make valid historical audit events unrepresentable.
SELECT 1;
