# Interview reschedule reason and notifications

Scope: Masterplan M2.11.03. An assigned Assessor may change an appointment before the interview is claimed or enters its waiting room. Changes require a trimmed reason of 10–1000 characters. The existing immutable schedule audit retains the previous time and reason. Repeated submissions of the same time/reminder create no additional event or notices.

The current authoritative request and persisted Assessor session/account/role are checked inside the existing locked transaction. Claimed runtime sessions cannot move. Required audit failure rolls back appointment, event pointer and downstream intents. Existing producers create three in-app and three email jobs; obsolete pending revisions suppress before dispatch, and current recipients receive the changed appointment. Free-form reasons stay out of generic emails.

Proof uses real scheduling and runtime producers, PGlite SQL, actual outbox worker with controlled provider responses, and Chromium against actual authenticated server actions. Tests also cover invalid reason submission through the server action, refresh of the Worker private record, audit rollback and mobile overflow. PGlite and controlled email acceptance do not prove multi-connection PostgreSQL, live Resend delivery or the whole Masterplan.
