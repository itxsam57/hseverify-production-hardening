-- M1.09 audit vocabulary, owner continuity and immutable Team history are
-- monotonic safety guarantees. Rolling the migration ledger back must not
-- weaken those accepted invariants or make existing audit/history rows invalid.
SELECT 1;
