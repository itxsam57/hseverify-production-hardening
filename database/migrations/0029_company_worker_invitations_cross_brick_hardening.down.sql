-- M1.10 cross-brick dependency hardening is monotonic. Reintroducing hard
-- foreign keys from retained M1.10 history into reversible lower bricks would
-- make lower migration rollback unsafe. Keep the guards and decoupling in place.
SELECT 1;
