import {createHash,randomUUID} from "node:crypto";
import {loadWorkerRegistrationTs} from "./worker-registration-runtime-loader.mjs";
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
// Native persisted-session producer; actual password/MFA evidence belongs to the browser suite.
export async function assessorSchedulingPrincipal(database,identity){
 const sessionId="schedule-native-"+randomUUID(),now=new Date().toISOString();
 await new AuthAccessRepository(database).authentication.insertSession({
  sessionId,accountId:identity.accountId,activeRole:"assessor",
  tokenHash:createHash("sha256").update(sessionId).digest("hex"),
  csrfTokenHash:createHash("sha256").update("csrf:"+sessionId).digest("hex"),
  userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,
  expiresAt:new Date(Date.now()+3600000).toISOString()
 });
 return {accountId:identity.accountId,sessionId,activeRole:"assessor",accountStatus:"active",tenantMembership:null};
}
