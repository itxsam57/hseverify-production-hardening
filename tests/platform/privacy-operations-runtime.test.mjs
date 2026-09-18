import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
const { PrivacyOperationsService } = loadTs("src/lib/privacy/privacy-operations-service.ts");
const { PrivacyOperationsRepository } = loadTs("src/lib/privacy/privacy-operations-repository.ts");

test("privacy operations persist requests accommodations and retention through repository boundary", async()=>{
 const calls=[];
 const service=new PrivacyOperationsService({createRequest:async x=>calls.push(["request",x]),addAccommodation:async x=>calls.push(["accommodation",x]),queueRetentionJob:async x=>calls.push(["retention",x])});
 assert.equal((await service.request({requestId:"r1",tenantId:"t1",workerId:"w1",type:"access"})).status,"OPEN");
 assert.equal((await service.accommodation({id:"a1",tenantId:"t1",workerId:"w1",type:"screen"})).status,"REQUESTED");
 assert.equal((await service.scheduleRetention({id:"j1",tenantId:"t1",resourceType:"evidence",before:"2026-01-01T00:00:00Z"})).status,"PENDING");
 assert.equal(calls.length,3);
});

test("privacy request rejects missing worker boundary", async()=>{
 const service=new PrivacyOperationsService({createRequest:async()=>{}});
 await assert.rejects(()=>service.request({requestId:"r",tenantId:"t1",workerId:"",type:"access"}));
});

test("retention rejects invalid dates before repository execution", async()=>{
 const service=new PrivacyOperationsService({queueRetentionJob:async()=>{throw new Error("should not write")}});
 await assert.rejects(()=>service.scheduleRetention({id:"j",tenantId:"t1",resourceType:"evidence",before:"bad"}));
});

test("retention completion crosses service repository boundary only from pending", async()=>{
 const calls=[];
 const service=new PrivacyOperationsService({completeRetentionJob:async x=>calls.push(x)});
 const result=await service.completeRetention({id:"j1",tenantId:"t1",status:"PENDING"});
 assert.equal(result.status,"COMPLETED");
 assert.deepEqual(calls,[{id:"j1",tenantId:"t1",status:"COMPLETED"}]);
});

test("retention completion rejects already closed jobs", async()=>{
 const service=new PrivacyOperationsService({completeRetentionJob:async()=>{throw new Error("should not write")}});
 await assert.rejects(()=>service.completeRetention({id:"j1",tenantId:"t1",status:"COMPLETED"}));
});

test("retention completion rejects missing tenant before repository write", async()=>{
 const service=new PrivacyOperationsService({completeRetentionJob:async()=>{throw new Error("should not write")}});
 await assert.rejects(()=>service.completeRetention({id:"j1",tenantId:"",status:"PENDING"}));
});

test("privacy completion and transitions require tenant boundary", async()=>{
 const calls=[];
 const service=new PrivacyOperationsService({completeRequest:async x=>calls.push(x),transitionRequest:async x=>calls.push(x)});
 await service.complete({requestId:"r1",workerId:"w1",tenantId:"t1",status:"OPEN"});
 await service.transition({requestId:"r1",workerId:"w1",tenantId:"t1",from:"OPEN",to:"PROCESSING"});
 assert.deepEqual(calls,[
  {requestId:"r1",workerId:"w1",tenantId:"t1",status:"COMPLETED"},
  {requestId:"r1",workerId:"w1",tenantId:"t1",from:"OPEN",to:"PROCESSING"}
 ]);
});

test("privacy completion rejects missing tenant before repository write", async()=>{
 const service=new PrivacyOperationsService({completeRequest:async()=>{throw new Error("should not write")}});
 await assert.rejects(()=>service.complete({requestId:"r1",workerId:"w1",tenantId:"",status:"OPEN"}));
});

test("privacy listing rejects missing tenant before repository read", async()=>{
 const service=new PrivacyOperationsService({
  listRequests:async()=>{throw new Error("should not read")},
  listAccommodations:async()=>{throw new Error("should not read")}
 });
 await assert.rejects(()=>service.listWorkerPrivacy("", "w1"));
});

test("privacy completion repository keeps closed records immutable", async()=>{
 const calls=[];
 const repository=new PrivacyOperationsRepository(Promise.resolve({
  query: async (...args)=>{calls.push(args); return {rowCount: 1};}
 }));
 await repository.completeRequest({requestId:"r1",workerId:"w1",tenantId:"t1",status:"COMPLETED"});
 assert.match(calls[0][0], /status='OPEN'/);
});

test("privacy repository does not report successful completion when the scoped update changes nothing", async()=>{
 const repository=new PrivacyOperationsRepository(Promise.resolve({
  query: async ()=>({rowCount: 0})
 }));
 await assert.rejects(()=>repository.completeRequest({requestId:"missing",workerId:"w1",tenantId:"t1",status:"COMPLETED"}));
});
