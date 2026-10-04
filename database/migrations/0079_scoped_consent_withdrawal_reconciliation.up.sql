-- Reconcile withdrawn scoped-link consents created before operative revocation.
-- Only matching owned links are changed; consent history remains immutable.
UPDATE scoped_share_links links
SET revoked_at = CURRENT_TIMESTAMP
WHERE links.revoked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM privacy_consent_records records
    JOIN auth_accounts accounts ON accounts.account_id=records.worker_id
    WHERE records.consent_type='scoped_share_links'
      AND records.action='WITHDRAWN'
      AND records.metadata->>'shareLinkId'=links.share_link_id
      AND NOT EXISTS (
        SELECT 1 FROM privacy_consent_records newer
        WHERE newer.consent_id=records.consent_id AND newer.version>records.version
      )
      AND (
        links.owner_worker_id=accounts.worker_reference
        OR EXISTS (
          SELECT 1 FROM worker_identity_worker_ids worker_ids
          WHERE worker_ids.worker_account_id=accounts.account_id
            AND worker_ids.permanent_worker_id=links.owner_worker_id
        )
      )
  );
