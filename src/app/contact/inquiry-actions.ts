"use server";
import { headers } from "next/headers";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { getDatabaseClient } from "@/lib/database/database";
import { publicVerificationRequestFingerprint } from "@/lib/public-verification/public-verification-request";
import { PublicInquiryRepository } from "@/lib/public-inquiry/public-inquiry-repository";
import { InquiryValidationError } from "@/lib/public-inquiry/public-inquiry-domain";
import type { InquiryActionState } from "@/components/public-inquiry/public-inquiry-form";
export async function submitPublicInquiryAction(_previous:InquiryActionState,form:FormData):Promise<InquiryActionState> {
 try {
  const env=getServerEnvironment(),requestHeaders=await headers();
  const ip=(requestHeaders.get("x-forwarded-for")?.split(",")[0]??requestHeaders.get("x-real-ip"))
   ?.replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,128)||null;
  const fingerprint=publicVerificationRequestFingerprint({ipAddress:ip,userAgent:null},env.sessionSecret);
  const input=Object.fromEntries(["kind","name","email","company","message","submissionNonce","website"].map(key=>[key,form.get(key)??""]));
  const result=await new PublicInquiryRepository(await getDatabaseClient(),env.sessionSecret).submit(input,fingerprint);
  return {status:"success",message:"Your request was received for staff follow-up. Keep this reference.",reference:result.reference};
 }catch(error){
  return {status:"error",message:error instanceof InquiryValidationError?error.message:"Your request could not be received. Please try again later.",reference:null};
 }
}
