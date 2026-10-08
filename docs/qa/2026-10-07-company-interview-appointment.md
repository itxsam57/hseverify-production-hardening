# Company appointment at the notification destination

Masterplan 19.1 and 23 require useful Worker/Company interview notifications. The existing Company link opened its owned Assurance Case row but showed no appointment time. The case table now reads and displays the current scheduled appointment in UTC.

The read reuses live tenant command authorization for company.orders.read, filters both tenant and order, joins matching case/request tenant scope, excludes cancelled/completed requests and selects the newest active request per case. A final database-clock check denies a session that expires during the read. Only the case reference and timestamp reach the view; assessor notes and free-form reschedule reasons stay private.

Actual scheduling and reasoned reschedule producers feed the native and Chromium tests. They verify current-time persistence, order isolation, forged scope/permission and revoked-session denial, Company refresh, Worker denial and 390px overflow. Controlled fixture data/PGlite do not certify live provider delivery, PostgreSQL load or all Masterplan scenarios.
