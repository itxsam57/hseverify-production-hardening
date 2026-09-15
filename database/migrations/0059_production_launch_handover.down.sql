-- Production launch handover records are operational history. Keep the
-- rollback path reversible in local/test environments without deleting
-- durable handover decisions or audit vocabulary.
SELECT 1;
