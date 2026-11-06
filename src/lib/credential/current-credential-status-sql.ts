/** Live credential lifecycle, separate from the historical Assurance Case decision.
 * All callers join `credential_issuances AS credentials` on an owned case.
 * Expiry is evaluated at read time; revoked/suspended override expiry.
 */
export const CURRENT_CREDENTIAL_STATUS_SQL = `CASE
 WHEN credentials.status IN ('revoked','suspended') THEN credentials.status
 WHEN credentials.status='expired' OR
  (credentials.status='valid' AND credentials.expires_at IS NOT NULL AND credentials.expires_at<=CURRENT_TIMESTAMP) THEN 'expired'
 WHEN credentials.status='valid' THEN 'valid'
 ELSE NULL
END`;
