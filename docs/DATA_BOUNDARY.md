# Dashboard Data Boundary

`WorkerDashboardProjection` is the only view model consumed by the Worker Dashboard. The current adapters return either an honest empty projection or environment-gated demonstration data. Production persistence must replace the adapter behind this interface rather than introducing browser-side authoritative state.

The projection query is request-deduplicated so the Worker Portal shell and dashboard content consume the same committed view during a render.
