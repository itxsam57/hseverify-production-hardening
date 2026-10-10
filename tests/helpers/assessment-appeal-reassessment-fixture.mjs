import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { assessmentFundingFixture } from "./assessment-funding-fixture.mjs";
import { loadWorkerRegistrationTs } from "./worker-registration-runtime-loader.mjs";
const { WorkerAssessmentApplicationService } = loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const { CredentialAppealsService } = loadWorkerRegistrationTs("src/lib/credential/credential-appeals-service.ts");
const { DecisionRepository } = loadWorkerRegistrationTs("src/lib/decision/decision-engine-repository.ts");
const { createDecision } = loadWorkerRegistrationTs("src/lib/decision/decision-engine-domain.ts");
const KEY="reassessment-test-signing-secret-more-than-32";

export async function acceptedReassessmentSource(fixture,database) {
 const service=new WorkerAssessmentApplicationService(database), now=new Date();
 const funded=await service.requestCompanyFunding(fixture.worker,fixture.fundingInput,now);
 await service.decideCompanyFunding(fixture.company,{fundingRequestId:funded.fundingRequestId,approved:true,now});
 const oldCase=(await database.query("SELECT cases.* FROM assurance_cases cases JOIN worker_assessment_applications applications ON applications.assurance_case_id=cases.case_id WHERE applications.application_id=$1",[funded.applicationId])).rows[0];
 // Schema-valid completed review prerequisites; the real final-decision producer issues the original credential.
 await database.query("UPDATE assurance_cases SET case_status='Decision pending',owner_kind='admin' WHERE case_id=$1",[oldCase.case_id]);
 const decision=createDecision({tenantId:oldCase.tenant_id,caseId:oldCase.case_id,state:"APPROVED",reasonCode:"review_ready",explanation:"Original evidence review is complete.",ruleVersion:"reassessment-test",inputReferences:[oldCase.case_id],createdAt:now.toISOString()});
 await new DecisionRepository(Promise.resolve(database),KEY).saveDecisionAndProgressCase(decision,fixture.credentials.admin.accountId);
 const issued=(await database.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[oldCase.case_id])).rows[0].credential_reference;
 const appeals=new CredentialAppealsService(Promise.resolve(database),KEY);
 const appeal=await appeals.submit({credentialId:issued,workerId:oldCase.permanent_worker_id,reason:"The original evidence requires an independently reviewed reassessment.",createdAt:now.toISOString()},"explicit_reassessment");
 const accepted=await appeals.reviewOutcome(appeal,{status:"accepted",reviewerId:fixture.credentials.admin.accountId,reason:"A new reassessment must retain its original credential and appeal lineage.",outcomeAction:"reassessment",reviewedAt:now.toISOString()});
 return {service,oldCase,appeal:accepted.appeal,now};
}

export async function assessmentAppealReassessmentFixture(){
 const fixture=await assessmentFundingFixture(),database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try {const source=await acceptedReassessmentSource(fixture,database);return {...fixture,oldCase:source.oldCase,appeal:source.appeal};}
 catch(error){await fixture.cleanup();throw error;}
 finally {await database.close();}
}
