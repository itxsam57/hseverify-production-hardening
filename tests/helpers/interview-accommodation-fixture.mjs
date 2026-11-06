import { policyInterview } from "./interview-policy-fixture.mjs";
import { accommodationPrincipal } from "./accommodation-delivery-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
export async function interviewAccommodationFixture({seed="support",languages=["English","Spanish"],adjustment={captions:true,interpreter:true},start=true,workerLanguage="Spanish"}={}){
 const x=await policyInterview({start:false});
 try{
  const db=x.database,worker=await accommodationPrincipal(db,x.fixture.credentials.worker.accountId,"worker",seed+"_worker"),assessor=await accommodationPrincipal(db,x.fixture.credentials.assessor.accountId,"assessor",seed+"_assessor"),foreign=await accommodationPrincipal(db,"search_foreign_worker","worker",seed+"_foreign");
  const {PrivacyOperationsService}=loadTs("src/lib/privacy/privacy-operations-service.ts"),{PrivacyOperationsRepository}=loadTs("src/lib/privacy/privacy-operations-repository.ts"),{InterviewAssignmentService}=loadTs("src/lib/interview/interview-assignment-service.ts");
  const privacy=new PrivacyOperationsService(new PrivacyOperationsRepository(Promise.resolve(db)));
  await privacy.accommodation({id:"support_"+seed,tenantId:null,workerId:worker.accountId,type:"Approved manual interview support"});
  await privacy.reviewAccommodation({accommodationId:"support_"+seed,reviewerAccountId:x.admin.accountId,decision:"APPROVED",reason:"Approved assigned human support without lowering competency requirements.",caseId:x.request.caseId,adjustment,now:x.now});
  await new InterviewAssignmentService(db).upsertProfile(x.admin,{assessorAccountId:assessor.accountId,tradeScopes:["electrical"],qualificationScopes:["level-3"],languages,jurisdictions:["GB"],riskLevels:["HIGH"],availability:{},maxActiveInterviews:8,status:"ACTIVE"});
  const {createEmptyWorkerProfile}=loadTs("src/lib/worker/profile-domain.ts"),{DatabaseWorkerProfileRepository}=loadTs("src/lib/worker/profile-repository.ts"),profiles=new DatabaseWorkerProfileRepository(Promise.resolve(db));
  const existing=await profiles.load(worker.accountId),ref=(await db.query("SELECT worker_reference FROM auth_accounts WHERE account_id=$1",[worker.accountId])).rows[0].worker_reference;
  const profile=existing??createEmptyWorkerProfile({workerSub:worker.accountId,workerId:ref,displayName:"Accessible Worker",email:worker.email,now:new Date().toISOString()});
  if(workerLanguage !== null) await profiles.save({...profile,personal:{...profile.personal,primaryLanguage:workerLanguage}},profile.version);
  const now=new Date();
  if(start){
   await x.runtime.markWorkerReady(worker,x.request.interviewRequestId,{cameraReady:true,microphoneReady:true,connectionReady:true,identityConfirmed:true,recordingConsent:false},now);
   await x.runtime.admit(assessor,x.request.interviewRequestId,now);
   x.session=await x.runtime.start(assessor,x.request.interviewRequestId,now);
  }
  return {...x,worker,assessor,foreign,privacy,now,profiles,profile,profileService:new InterviewAssignmentService(db)};
 }catch(error){await x.cleanup();throw error;}
}
