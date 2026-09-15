import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
const { PrivacyOperationsService } = loadTs("src/lib/privacy/privacy-operations-service.ts");

test("privacy operations persist requests accommodations and retention through repository boundary", async()=>{
 const calls=[];
 const service=new PrivacyOperationsService({createRequest:async x=>calls.push(["request",x]),addAccommodation:async x=>calls.push(["accommodation",x]),queueRetentionJob:async x=>calls.push(["retention",x])});
 assert.equal((await service.request({requestId:"r1",workerId:"w1",type:"access"})).status,"OPEN");
 assert.equal((await service.accommodation({id:"a1",workerId:"w1",type:"screen"})).status,"REQUESTED");
 assert.equal((await service.scheduleRetention({id:"j1",resourceType:"evidence",before:"2026-01-01T00:00:00Z"})).status,"PENDING");
 assert.equal(calls.length,3);
});

test("privacy request rejects missing worker boundary", async()=>{
 const service=new PrivacyOperationsService({createRequest:async()=>{}});
 await assert.rejects(()=>service.request({requestId:"r",workerId:"",type:"access"}));
});

test("retention rejects invalid dates before repository execution", async()=>{
 const service=new PrivacyOperationsService({queueRetentionJob:async()=>{throw new Error("should not write")}});
 await assert.rejects(()=>service.scheduleRetention({id:"j",resourceType:"evidence",before:"bad"}));
});

test("retention completion crosses service repository boundary only from pending", async()=>{
 const calls=[];
 const service=new PrivacyOperationsService({completeRetentionJob:async x=>calls.push(x)});
 const result=await service.completeRetention({id:"j1",status:"PENDING"});
 assert.equal(result.status,"COMPLETED");
 assert.deepEqual(calls,[{id:"j1",status:"COMPLETED"}]);
});

test("retention completion rejects already closed jobs", async()=>{
 const service=new PrivacyOperationsService({completeRetentionJob:async()=>{throw new Error("should not write")}});
 await assert.rejects(()=>service.completeRetention({id:"j1",status:"COMPLETED"}));
});
