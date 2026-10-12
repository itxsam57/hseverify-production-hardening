# Credential validity policy

The credential Decision Engine uses the Effective Policy already pinned to its Assurance Case. The immutable decision creation timestamp is the issue timestamp. A later policy version or an approval override never restarts the validity period of an existing decision or credential.

Use one optional field in the policy values JSON:

- `"credentialValidityDays": 365` defines a positive whole number of UTC days from the issue timestamp.
- `"credentialValidity": "no_expiry"` explicitly defines no scheduled expiry.
- Omitting both fields leaves validity unspecified. It does not invent a default duration.

The two fields are mutually exclusive. Malformed values and an expiry outside the supported four-digit-year UTC range (0000–9999) fail before issuance and roll back the decision transaction.

To permit Company shortening, allow `credentialValidityDays` with the `MAXIMUM` override direction. For example, a global 365-day policy can accept a 30-day Company override and rejects a 366-day override. The resolved value is pinned with its case and tenant.

New decision-issued QR payloads include the pinned snapshot ID, policy version ID and validity configuration inside the authenticated issuance payload. Historical authenticated QR payloads without validity metadata keep their original verification format. Historical checksum records retain their existing explicit unauthenticated-issuance warning.

Public verification, the credential API, PDF, Digital Passport and scoped competency sharing derive expired status at the observation time. Suspension and revocation take precedence. This projection does not rewrite the original issuance, signature, QR payload or retained lifecycle and Living Record events.

The existing PDF endpoint renders the current bounded public credential projection. It is not a separately persisted or cryptographically signed private PDF artifact.

The scanner accepts the issued JSON envelope, its bounded Credential ID or matching same-origin public URL. It extracts only a lookup reference; existing server verification authenticates the stored issuance and derives live status. Scanned metadata does not authenticate the envelope or supply a public status. Camera activation remains explicit and manual lookup remains available.


Accepted renewal issues a distinct credential through the existing positive decision producer using a fresh case and the applicable configured policy. The original case, decision, policy snapshot, signed QR, signature, issue date and expiry remain unchanged. An immutable appeal/old/new association records internal REPLACED. The old public API, page and PDF use the supported revoked status with the fixed replacement restriction; this is distinguishable from disciplinary revocation. The Living Record retains prior versions and appends the replacement outcome. Replaced issuance cannot be reactivated.

An accepted reassessment is linked only when the Worker deliberately continues that exact appeal into an application. The stored source association freezes the accepted appeal version and original Worker, tenant, framework, case, credential and decision. Company scope requires its current active owned link. A later positive decision for that explicitly associated new case authenticates the original issuance, uses the new case's pinned configured validity and records replacement atomically. Independent applications do not imply replacement. Failed source, authentication, validity or independence checks roll back the new issuance and preserve the original history.
