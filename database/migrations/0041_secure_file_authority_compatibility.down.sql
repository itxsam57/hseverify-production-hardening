-- History-preserving logical rollback.
--
-- 0041 repairs a compatibility envelope shared by accepted M1.08 and M1.12
-- behavior. Reinstating the 0032 trigger on rollback would deliberately
-- reintroduce the known pending-Company evidence regression. As with other
-- forward compatibility repairs, the physical function remains widened while
-- the migration ledger may roll back/reapply deterministically.
SELECT 1;
