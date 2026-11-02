


import { PGlite } from "@electric-sql/pglite";
import { assessorInterviewSearchFixture } from "../helpers/assessor-interview-search-fixture.mjs";
import { assessorSchedulingPrincipal } from "../helpers/assessor-scheduling-native-principal.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";

const { InterviewSchedulingService } = loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const { InterviewRuntimeService } = loadWorkerRegistrationTs("src/lib/interview/interview-runtime-service.ts");
const { InterviewPlaybookService } = loadWorkerRegistrationTs("src/lib/interview/interview-playbook-service.ts");
const dimensions = [
  "technicalKnowledge", "practicalReasoning", "safetyAwareness", "communication",
  "consistencyWithWrittenAnswers", "confidenceClarity", "tradeJudgment"
];
const completeScores = () => Object.fromEntries([
  ...dimensions.map((name) => [name, 3]),
  ["comments", "Candidate explained the controls and supported the recommendation."]
]);

// Latest-schema isolated case setup comes from the existing search fixture.
// Actual scheduling, claim/ready/admit/start, draft, playbook and End services run
// against its PGlite database. Readiness inputs are supplied, not media proof.
export async function activeInterview({ createPlaybook = true, start = true, scheduleOffset = 0 } = {}) {
  const fixture = await assessorInterviewSearchFixture();
  let database;
  try {
    database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    await attachNotificationCompanyLink(database,fixture);
    const principal = await assessorSchedulingPrincipal(database, fixture.credentials.assessor);
    const worker = {
      accountId: fixture.credentials.worker.accountId,
      activeRole: "worker", accountStatus: "active", tenantMembership: null
    };
    const scheduling = new InterviewSchedulingService(database);
    const runtime = new InterviewRuntimeService(Promise.resolve(database));
    const playbook = new InterviewPlaybookService(Promise.resolve(database));
    const request = await scheduling.scheduleInterview({
      principal, tenantId: fixture.credentials.company.tenantId,
      request: fixture.requests.Alpha, scheduledAt: new Date(Date.now() + scheduleOffset).toISOString()
    });
    let session = await runtime.claim(principal, request.interviewRequestId);
    if (createPlaybook) await playbook.ensure(principal, request.interviewRequestId);
    if (start) {
      await runtime.markWorkerReady(worker, request.interviewRequestId, {
        cameraReady: true, microphoneReady: true, connectionReady: true,
        identityConfirmed: true, recordingConsent: false
      });
      await runtime.admit(principal, request.interviewRequestId);
      session = await runtime.start(principal, request.interviewRequestId);
    }
    return {
      fixture, database, principal, scheduling, runtime, playbook, request, session,
      save: (scorecard, submitted = false) => scheduling.saveConsoleState({
        tenantId: fixture.credentials.company.tenantId,
        interviewSessionId: session.interviewSessionId,
        interviewRequestId: request.interviewRequestId,
        notes: [], scorecard, recommendation: null, submitted,
        updatedAt: new Date().toISOString()
      }),
      cleanup: async () => { await database.close(); await fixture.cleanup(); }
    };
  } catch (error) {
    if (database) await database.close();
    await fixture.cleanup();
    throw error;
  }
}


// This setup supplies a schema-valid accepted Company link for notification access;
// it does not certify the invitation or acceptance journey.
export async function attachNotificationCompanyLink(database,fixture){
 const link="company_worker_link_"+ "n".repeat(24),invitation="worker_invitation_"+ "n".repeat(24);
 const c=fixture.credentials.company,w=fixture.credentials.worker;
 await database.query("INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at) VALUES($1,$2,$3,$4,'accepted',$5,$6,clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp())",[invitation,c.tenantId,w.email,"notification-context-hash",c.membershipId,w.accountId]);
 await database.query("INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,worker_accepted_at,activated_at) VALUES($1,$2,$3,'invitation',$4,'active',clock_timestamp(),clock_timestamp())",[link,c.tenantId,w.accountId,invitation]);
 await database.query("UPDATE assurance_cases SET worker_link_id=$1 WHERE tenant_id=$2 AND worker_account_id=$3",[link,c.tenantId,w.accountId]);
}
