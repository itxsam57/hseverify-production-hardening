import "server-only";
import { randomBytes, createHmac } from "node:crypto";
import type { DatabaseClient } from "@/lib/database/database";
import { DatabaseAuditRepository } from "@/lib/audit/audit-repository";
import { bindTrustedSystemAuditActor, derivePlatformAuditReadScope } from "@/lib/audit/audit-domain";
import type { PlatformAuditReadPrincipal } from "@/lib/audit/audit-domain";
import { AUDIT_PLATFORM_READ_GUARD_SQL } from "@/lib/audit/audit-repository";
import { normalizeInquiry, inquirySubmissionKey } from "./public-inquiry-domain";
export class PublicInquiryRepository {
 constructor(private readonly db: DatabaseClient, private readonly secret: string) {
  if (secret.length<32) throw new Error("Inquiry secret is invalid.");
 }
 async submit(input: Record<string,unknown>, fingerprint: string, now=new Date()) {
  const inquiry=normalizeInquiry(input);
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isFinite(now.getTime())) throw new Error("Inquiry request is invalid.");
  const key=inquirySubmissionKey(inquiry.submissionNonce);
  return this.db.transaction(async tx=>{
   const id="inquiry_"+randomBytes(18).toString("base64url");
   const inserted=await tx.query<{inquiry_id:string}>(`INSERT INTO public_inquiries
    (inquiry_id,submission_key,fingerprint_hash,kind,contact_name,email,company,message)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(submission_key) DO NOTHING RETURNING inquiry_id`,
    [id,key,fingerprint,inquiry.kind,inquiry.name,inquiry.email,inquiry.company,inquiry.message]);
   if (!inserted.rows.length) {
    const prior=await tx.query<{inquiry_id:string}>(`SELECT inquiry_id FROM public_inquiries
     WHERE submission_key=$1 AND fingerprint_hash=$2 AND kind=$3 AND contact_name=$4
     AND email=$5 AND company=$6 AND message=$7`,
     [key,fingerprint,inquiry.kind,inquiry.name,inquiry.email,inquiry.company,inquiry.message]);
    if (!prior.rows.length) throw new Error("Reload the form and try again.");
    return {reference:prior.rows[0].inquiry_id,created:false};
   }
   await tx.query("DELETE FROM public_inquiry_rate_windows WHERE window_start<$1", [new Date(now.getTime()-48*3600000).toISOString()]);
   const window=new Date(Math.floor(now.getTime()/3600000)*3600000).toISOString();
   for (const [purpose,value,limit] of [["email",inquiry.email,5],["ip",fingerprint,20]] as const) {
    const bucket=createHmac("sha256",this.secret).update("public-inquiry:"+purpose+":"+value).digest("hex");
    const quota=await tx.query(`INSERT INTO public_inquiry_rate_windows(bucket_key,window_start,used)
      VALUES($1,$2,1) ON CONFLICT(bucket_key,window_start) DO UPDATE
      SET used=public_inquiry_rate_windows.used+1 WHERE public_inquiry_rate_windows.used<$3 RETURNING used`,
      [bucket,window,limit]);
    if (!quota.rows.length) throw new Error("Too many requests. Please try again later.");
   }
   await new DatabaseAuditRepository(Promise.resolve(tx)).append(
    bindTrustedSystemAuditActor("public-inquiry-intake"),{
     action:"public_inquiry.received",outcome:"succeeded",
     target:{type:"resource",reference:id},metadata:{kind:inquiry.kind,systemComponent:"public-inquiry-intake"}
    });
   return {reference:id,created:true};
  });
 }
 async list(principal: PlatformAuditReadPrincipal, page=0) {
  const scope=derivePlatformAuditReadScope(principal);
  if(!Number.isSafeInteger(page)||page<0||page>10000) throw new Error("Invalid page.");
  return this.db.transaction(async tx=>{
   const guard=await tx.query<{session_id:string}>(AUDIT_PLATFORM_READ_GUARD_SQL,
    [scope.sessionId,scope.accountId,scope.activeRole,new Date().toISOString()]);
   if(guard.rows[0]?.session_id!==scope.sessionId) throw new Error("Inquiry access denied.");
   return (await tx.query(`SELECT inquiry_id,kind,contact_name,email,company,message,received_at
    FROM public_inquiries ORDER BY received_at DESC,inquiry_id DESC LIMIT 26 OFFSET $1`,[page*25])).rows;
  });
 }
}
