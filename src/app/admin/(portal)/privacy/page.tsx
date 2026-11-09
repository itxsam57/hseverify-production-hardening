import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { ConsentRecordService } from "@/lib/privacy/consent-record-service";
import { PrivacyOperationsService } from "@/lib/privacy/privacy-operations-service";
import { reviewAccommodationAction, reviewPrivacyRequestAction, scheduleRetentionAction, executeRetentionAction } from "./actions";

export const dynamic = "force-dynamic";

function iso(value: string | Date | null): string {
  if (!value) return "—";
  return new Date(value).toISOString();
}

export default async function AdminPrivacyPage({searchParams}: {searchParams:Promise<{privacyError?:string}>}): Promise<React.JSX.Element> {
  const query=await searchParams;
  await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const privacy = new PrivacyOperationsService();
  const [requests, accommodations, consents, retentionJobs, retentionTenants] = await Promise.all([
    privacy.listRequestReviewQueue(),
    privacy.listAccommodationReviewQueue(),
    new ConsentRecordService().listRecent(100),
    privacy.listRetentionJobs(),
    privacy.listRetentionTenants()
  ]);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Admin privacy operations</p>
          <h1>Privacy, consent & accommodation review</h1>
          <p>Need-to-know operational review. Competency standards are never reduced by an accommodation.</p>
        </div>
      </div>

      {query.privacyError ? <p role="alert">{query.privacyError.slice(0,240)}</p> : null}

      <section className="page-section content-stack">
        <h2>Privacy requests</h2>
        <p>Record intake and reasoned review. Fulfilment remains open until the requested operation is performed.</p>
        {requests.length === 0 ? <p>No privacy requests.</p> : requests.map((request) => (
          <article className="panel content-stack" key={request.request_id}>
            <p>Request type: {request.request_type.replaceAll("_", " ")}</p>
            <p>Worker: {request.worker_id}</p>
            <p>Status: {request.status}</p>
            {request.execution_pending ? <p>Approved recording erasure awaits verified completion. Resume this exact plan; another review decision is unavailable.</p> : null}
            <p>Requested: {iso(request.created_at)}</p>
            {typeof request.details?.sharePurpose === "string" ? <p>Share link: {request.details.sharePurpose}</p> : null}
            {typeof request.details?.consentPurpose === "string" ? <p>Consent: {request.details.consentPurpose}</p> : null}
            {request.request_type === "restriction" && request.details?.purpose === "optional_sharing" ? <p>Scope: optional share links. Completion revokes existing links and prevents new links. Required case processing and retained evidence continue.</p> : null}
            {request.request_type==="correction" && (request.details?.correction as {scope?:string}|undefined)?.scope==="profile_contact_city" ? <p>Requested city: {String((request.details.correction as {city:string}).city)} · Profile version {String((request.details.correction as {expectedProfileVersion:number}).expectedProfileVersion)}</p> : null}
            {request.request_type==="deletion" && (request.details?.deletion as {scope?:string}|undefined)?.scope==="expired_recording" ? <p>Requested recording: {String((request.details.deletion as {recordingAssetId:string}).recordingAssetId)}. Erasure requires expired policy, a closed case and no legal hold or open appeal. Identity, case metadata, decisions and audit history remain retained.</p> : null}
            {["correction","deletion"].includes(request.request_type) && !request.details?.correction && !request.details?.deletion ? <p>General request requires a separately approved execution policy. Record a review response; completion is unavailable.</p> : null}
            {typeof request.details?.description==="string" ? <p>Worker description: {request.details.description}</p> : null}
            {request.review_reason ? <p>Review outcome: {request.review_reason}</p> : null}
            {["OPEN", "PROCESSING"].includes(request.status) ? (
              <form action={reviewPrivacyRequestAction} className="form-grid">
                <input type="hidden" name="requestId" value={request.request_id} />
                <input type="hidden" name="expectedStatus" value={request.status} />
                <label>Request decision
                  <select name="decision" defaultValue={request.execution_pending ? "COMPLETED" : request.status === "OPEN" ? "PROCESSING" : "REJECTED"} required>
                    {request.status === "OPEN" && !request.execution_pending ? <option value="PROCESSING">Start processing</option> : null}
                    {!request.execution_pending ? <option value="REJECTED">Reject request</option> : null}
                    {request.request_type === "consent_withdrawal" && typeof request.details?.consentId === "string" && request.details.consentId.trim() ? (
                      <option value="COMPLETED">Withdraw requested optional sharing consent and complete</option>
                    ) : null}
                    {request.request_type === "restriction" && request.details?.purpose === "optional_sharing" ? <option value="COMPLETED">Restrict optional share links and complete</option> : null}
                    {request.request_type==="correction" && (request.details?.correction as {scope?:string}|undefined)?.scope==="profile_contact_city" ? <option value="COMPLETED">Apply approved city correction and complete</option> : null}
                    {request.request_type==="deletion" && (request.details?.deletion as {scope?:string}|undefined)?.scope==="expired_recording" ? <option value="COMPLETED">Erase approved expired recording and complete</option> : null}
                    {request.request_type === "retention_inquiry" ? <option value="COMPLETED">Answer retention inquiry and complete</option> : null}
                    {["access","export"].includes(request.request_type) ? (
                      <option value="COMPLETED">Prepare Worker data download and complete</option>
                    ) : null}
                    {request.request_type === "share_link_revocation" && typeof request.details?.shareLinkId === "string" && request.details.shareLinkId.trim() ? (
                      <option value="COMPLETED">Revoke requested share link and complete</option>
                    ) : null}
                  </select>
                </label>
                {request.request_type==="correction" && (request.details?.correction as {scope?:string}|undefined)?.scope==="profile_contact_city" ? <>
                  <input type="hidden" name="correctionScope" value="profile_contact_city" />
                  <input type="hidden" name="correctionCity" value={String((request.details.correction as {city:string}).city)} />
                  <input type="hidden" name="profileVersion" value={String((request.details.correction as {expectedProfileVersion:number}).expectedProfileVersion)} />
                  <label><input type="checkbox" name="approveExactScope" value="yes" />I approve the exact requested city and profile version</label>
                </> : null}
                {request.request_type==="deletion" && (request.details?.deletion as {scope?:string}|undefined)?.scope==="expired_recording" ? <>
                  <input type="hidden" name="deletionScope" value="expired_recording" />
                  <input type="hidden" name="recordingAssetId" value={String((request.details.deletion as {recordingAssetId:string}).recordingAssetId)} />
                  <label><input type="checkbox" name="approveExactScope" value="yes" />I approve erasure of this exact recording under its current retention policy</label>
                  <p>Completion revokes the Worker sessions and share links. A durable approval remains available for retry if object storage or final persistence fails.</p>
                </> : null}
                <label>Request review reason<textarea name="reason" minLength={10} maxLength={2000} required /></label>
                {request.request_type === "retention_inquiry" ? <p>Provide the Worker with the applicable retention categories, policy and any holds in your review response. Completing this inquiry records your answer; it does not delete records.</p> : null}
                <button type="submit">Save privacy request decision</button>
              </form>
            ) : null}
          </article>
        ))}
      </section>

      <section className="page-section content-stack">
        <h2>Recording retention</h2>
        <p>Execute expired interview recording retention for one company. Legal holds, open cases and open appeals block the job. Other retention categories require their own approved policy executor.</p>
        <form action={scheduleRetentionAction} className="form-grid" aria-label="Schedule recording retention">
          <label>Company retention scope<select name="tenantId" required>
            {retentionTenants.map(tenant=><option key={tenant.tenant_id} value={tenant.tenant_id}>{tenant.display_name}</option>)}
          </select></label>
          <label>Retention cutoff date<input type="date" name="retentionBefore" max={new Date().toISOString().slice(0,10)} required /></label>
          <button type="submit">Schedule recording retention</button>
        </form>
        {retentionJobs.map(job=><article className="panel content-stack" key={job.job_id}>
          <p>Retention category: {job.resource_type.replaceAll("_"," ")}</p>
          <p>Status: {job.status} · Cutoff: {iso(job.retention_before)}</p>
          {job.status==="COMPLETED" ? <p>Purged recordings: {String(job.execution_result?.purgedRecordings??"No execution receipt recorded")}</p> : null}
          {job.status==="PENDING" && job.tenant_id && job.resource_type==="expired_interview_recordings" ? <form action={executeRetentionAction} className="form-grid">
            <input type="hidden" name="jobId" value={job.job_id} /><input type="hidden" name="tenantId" value={job.tenant_id} />
            <label><input type="checkbox" name="approveRetention" value="yes" required />I approve the current policy eligible recording targets</label>
            <label>Retention execution reason<textarea name="reason" minLength={10} maxLength={2000} required /></label>
            <button type="submit">Execute recording retention</button>
          </form> : job.status==="PENDING" ? <p>Blocked: this retention category or tenant scope has no approved executor.</p> : null}
        </article>)}
      </section>

      <section className="page-section content-stack">
        <h2>Accommodation queue</h2>
        {accommodations.length === 0 ? <p>No accommodation requests.</p> : accommodations.map((item) => (
          <article className="panel content-stack" key={item.accommodation_id}>
            <div>
              <strong>{item.accommodation_type}</strong>
              <p>Worker: {item.worker_id}</p>
              <p>Status: {item.status}</p>
              <p>Requested: {iso(item.created_at)}</p>
              {item.review_reason ? <p>Review reason: {item.review_reason}</p> : null}
            </div>
            {item.status === "REQUESTED" ? (
              <form action={reviewAccommodationAction} className="form-grid">
                <input type="hidden" name="accommodationId" value={item.accommodation_id} />
                <label>
                  Decision
                  <select name="decision" defaultValue="APPROVED" required>
                    <option value="APPROVED">Approve</option>
                    <option value="DECLINED">Decline</option>
                  </select>
                </label>
                <label>
                  Assurance Case
                  <select name="caseId" defaultValue="">
                    <option value="">Select case for approval</option>
                    {item.cases.map((entry) => (
                      <option value={entry.case_id} key={entry.case_id}>
                        {entry.order_name ?? entry.order_reference ?? entry.case_id} — {entry.case_status}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Time multiplier
                  <input name="timeMultiplier" type="number" min="1" max="2" step="0.05" defaultValue="1" />
                </label>
                <label>
                  Extra break minutes
                  <input name="extraBreakMinutes" type="number" min="0" max="60" step="1" defaultValue="0" />
                </label>
                <label><input type="checkbox" name="screenReader" value="yes" /> Screen reader</label>
                <label><input type="checkbox" name="captions" value="yes" /> Captions</label>
                <label><input type="checkbox" name="interpreter" value="yes" /> Interpreter</label>
                <label><input type="checkbox" name="reducedMotion" value="yes" /> Reduced motion</label>
                <label>
                  Review reason
                  <textarea name="reason" minLength={10} maxLength={2000} required />
                </label>
                <button type="submit">Save accommodation decision</button>
              </form>
            ) : null}
          </article>
        ))}
      </section>

      <section className="page-section content-stack">
        <h2>Recent consent history</h2>
        {consents.length === 0 ? <p>No consent records.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Worker</th><th>Type</th><th>Action</th><th>Case</th><th>Version</th><th>Recorded</th></tr></thead>
              <tbody>
                {consents.map((consent) => (
                  <tr key={consent.consentId + ":" + consent.version}>
                    <td>{consent.workerId}</td>
                    <td>{consent.consentType.replaceAll("_", " ")}</td>
                    <td>{consent.action}</td>
                    <td>{consent.caseId ?? "—"}</td>
                    <td>{consent.version}</td>
                    <td>{consent.recordedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
