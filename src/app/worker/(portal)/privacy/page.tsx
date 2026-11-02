import {
  submitAccommodationAction,
  submitPrivacyRequestAction,
  withdrawConsentAction
} from "./actions";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { ConsentRecordService } from "@/lib/privacy/consent-record-service";
import { PrivacyOperationsService } from "@/lib/privacy/privacy-operations-service";

export const dynamic = "force-dynamic";

export default async function WorkerPrivacyPage({searchParams}: {searchParams:Promise<{privacyError?:string}>}): Promise<React.JSX.Element> {
  const query=await searchParams;
  const principal = await requirePortalAuthorization("worker");
  const service = new PrivacyOperationsService();
  const [privacy, currentConsents, consentHistory, shareLinks, recordingAssets, profileVersion] = await Promise.all([
    service.listWorkerPrivacy(
      principal.tenantMembership?.tenantId ?? null,
      principal.accountId,
      principal.accountId
    ),
    new ConsentRecordService().listCurrentWorker(principal.accountId),
    new ConsentRecordService().listWorkerHistory(principal.accountId),
    service.listOwnedShareLinks(principal.accountId),
    service.listOwnedRecordingAssets(principal.accountId),
    service.currentContactCorrectionVersion(principal.accountId)
  ]);

  return (
    <div className="dashboard-page page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Worker privacy</p>
          <h1>Privacy, consent & data rights</h1>
          <p>Requests and consent history stay attached to your Worker account and preserve audit history.</p>
        </div>
      </div>

      {query.privacyError ? <p role="alert">Request could not be saved. Check the selected scope and current profile version, then try again.</p> : null}

      <section className="panel page-section content-stack">
        <h2>Privacy request</h2>
        <p>Restricting optional share links revokes your existing links and prevents new links after Admin completion. Required case processing and retained evidence continue.</p>
        <form action={submitPrivacyRequestAction} className="form-grid" aria-label="privacy request form">
          <label>
            Request type
            <select name="type" defaultValue="access" aria-label="Privacy request type">
              <option value="access">Access</option>
              <option value="correction">Correction</option>
              <option value="restriction">Restrict optional share links</option>
              <option value="consent_withdrawal">Consent withdrawal</option>
              <option value="share_link_revocation">Share-link revocation</option>
              <option value="retention_inquiry">Retention inquiry</option>
              <option value="export">Export</option>
              <option value="deletion">Deletion where legally permissible</option>
            </select>
          </label>
          <label>Share link for a revocation request
            <select name="shareLinkId" defaultValue="">
              <option value="">Choose a link when requesting revocation</option>
              {shareLinks.map(link => <option key={link.share_link_id} value={link.share_link_id}>{link.purpose}</option>)}
            </select>
          </label>
          <label>Optional sharing consent for a withdrawal request
            <select name="consentId" defaultValue="">
              <option value="">Choose a consent when requesting withdrawal</option>
              {currentConsents.filter(consent => consent.consentType === "scoped_share_links" &&
                consent.action === "GRANTED" && consent.withdrawalRule === "FUTURE_PROCESSING_ONLY").map(consent => (
                <option key={consent.consentId} value={consent.consentId}>
                  {typeof consent.metadata.sharePurpose === "string" ? consent.metadata.sharePurpose : consent.purpose}
                </option>
              ))}
            </select>
          </label>
          <label>Correction scope
            <select name="correctionScope" aria-label="Correction scope" defaultValue="">
              <option value="">General correction for staff review</option>
              {profileVersion ? <option value="profile_contact_city">Correct profile contact city</option> : null}
            </select>
          </label>
          <label>Requested profile city<input name="correctionCity" minLength={2} maxLength={100} /></label>
          <input type="hidden" name="profileVersion" value={profileVersion??""} />
          <label>Deletion scope
            <select name="deletionScope" aria-label="Deletion scope" defaultValue="">
              <option value="">General deletion for staff and retention review</option>
              <option value="expired_recording">Erase one expired recording where policy permits</option>
            </select>
          </label>
          <label>Recording for an erasure request
            <select name="recordingAssetId" aria-label="Recording for an erasure request" defaultValue="">
              <option value="">Choose your recording</option>
              {recordingAssets.map(asset=><option key={asset.recording_asset_id} value={asset.recording_asset_id}>
                {asset.recording_asset_id} · Retained until {new Date(asset.retention_until).toISOString().slice(0,10)}{asset.legal_hold?" · Legal hold":""}
              </option>)}
            </select>
          </label>
          <label>Request description<textarea name="requestDescription" maxLength={2000} /></label>
          <p>City corrections require your current profile version and exact Admin approval. Other corrections remain open for review. Recording erasure requires expired retention, a closed case and no legal hold or open appeal. It signs you out and revokes share links; identity, case metadata, decisions and audit history remain retained. General deletion requests require a separate approved policy before execution.</p>
          <button type="submit">Submit privacy request</button>
        </form>
      </section>

      <section className="panel page-section content-stack">
        <h2>Accessibility accommodation</h2>
        <form action={submitAccommodationAction} className="form-grid" aria-label="accessibility accommodation form">
          <label>
            Accommodation request
            <input name="type" required minLength={3} maxLength={240} aria-label="Accommodation request" />
          </label>
          <button type="submit">Submit accommodation</button>
        </form>
      </section>

      <section className="page-section content-stack">
        <h2>Current consent state</h2>
        {currentConsents.length === 0 ? <p>No consent records yet.</p> : currentConsents.map((consent) => (
          <article className="panel content-stack" key={consent.consentId}>
            <div>
              <strong>{consent.consentType.replaceAll("_", " ")}</strong>
              <p>{consent.purpose}</p>
              {typeof consent.metadata.sharePurpose === "string" ? (
                <p>Share link purpose: {consent.metadata.sharePurpose}</p>
              ) : null}
              <p>Status: {consent.action} · Version {consent.version}</p>
              {consent.caseId ? <p>Case: {consent.caseId}</p> : null}
            </div>
            {consent.action === "GRANTED" && consent.withdrawalRule === "FUTURE_PROCESSING_ONLY" ? (
              <form action={withdrawConsentAction} className="form-grid">
                <input type="hidden" name="consentId" value={consent.consentId} />
                <label>
                  Withdrawal reason
                  <input name="reason" required minLength={5} maxLength={1000} />
                </label>
                <button type="submit">Withdraw future processing consent</button>
              </form>
            ) : null}
            {consent.withdrawalRule === "NOT_WITHDRAWABLE_WHILE_REQUIRED" && consent.action === "GRANTED" ? (
              <p className="muted-copy">This consent is tied to an active required workflow. Its historical evidence is retained.</p>
            ) : null}
          </article>
        ))}
      </section>

      <section className="page-section content-stack">
        <h2>Your privacy requests</h2>
        {privacy.requests.length === 0 ? <p>No privacy requests yet.</p> : privacy.requests.map((request) => (
          <article className="record-row" key={request.request_id}>
            <p>{request.request_type.replaceAll("_", " ")}: {request.status}</p>
            {typeof request.details?.sharePurpose === "string" ? <p>Share link: {request.details.sharePurpose}</p> : null}
            {typeof request.details?.consentPurpose === "string" ? <p>Consent: {request.details.consentPurpose}</p> : null}
            {request.request_type === "restriction" && request.details?.purpose === "optional_sharing" ? <p>{request.status === "COMPLETED" ? "Optional share links are restricted. Existing links are revoked and new links are unavailable." : "Requested scope: optional share links. Required case processing and retained evidence continue."}</p> : null}
            {request.request_type==="correction" && typeof (request.details?.correction as {city?:unknown}|undefined)?.city==="string" ? <p>Requested city: {String((request.details.correction as {city:string}).city)}</p> : null}
            {request.request_type==="deletion" && (request.details?.deletion as {scope?:string}|undefined)?.scope==="expired_recording" ? <p>Scope: one policy eligible expired recording. Identity, case metadata, decisions and audit history remain retained.</p> : null}
            {["correction","deletion"].includes(request.request_type) && !request.details?.correction && !request.details?.deletion && request.status!=="REJECTED" ? <p>General request: staff must define and approve its execution policy. This request has not been fulfilled.</p> : null}
            {request.review_reason ? <p>Review outcome: {request.review_reason}</p> : null}
            {request.status === "COMPLETED" && ["access","export"].includes(request.request_type) &&
              (request.details?.fulfilment as { method?: string } | undefined)?.method === "owned_current_data_download" ? (
                <a href={`/api/privacy/requests/${encodeURIComponent(request.request_id)}/download`}>Download your current data (JSON)</a>
              ) : null}
          </article>
        ))}
      </section>

      <section className="page-section content-stack">
        <h2>Your accommodations</h2>
        {privacy.accommodations.length === 0 ? <p>No accommodation requests yet.</p> : privacy.accommodations.map((request) => (
          <article className="record-row" key={request.accommodation_id}>
            <div>
              <strong>{request.accommodation_type}</strong>
              <p>Status: {request.status}</p>
            {request.review_reason ? <p>Review outcome: {request.review_reason}</p> : null}
              {request.case_id ? <p>Applied to case: {request.case_id}</p> : null}
            </div>
          </article>
        ))}
      </section>

      <section className="page-section content-stack">
        <h2>Consent history</h2>
        {consentHistory.length === 0 ? <p>No consent history yet.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Type</th><th>Action</th><th>Version</th><th>Case</th><th>Recorded</th></tr></thead>
              <tbody>
                {consentHistory.map((consent) => (
                  <tr key={consent.consentId + ":" + consent.version}>
                    <td>{consent.consentType.replaceAll("_", " ")}</td>
                    <td>{consent.action}</td>
                    <td>{consent.version}</td>
                    <td>{consent.caseId ?? "—"}</td>
                    <td>{consent.recordedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
