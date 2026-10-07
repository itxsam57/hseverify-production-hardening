import type {OtpProviderConfig} from "../auth/otp-provider-transport";
export type InterviewEmailResult =
 | Readonly<{kind:"accepted";providerReference:string}>
 | Readonly<{kind:"retryable" | "terminal";code:string}>;
export async function sendInterviewEmail(input:Readonly<{
 providers:OtpProviderConfig;publicBaseUrl?:string;recipient:string;href:string;idempotencyKey:string;
}>,fetcher:typeof fetch=fetch):Promise<InterviewEmailResult>{
 const safe=(value:string|undefined,max:number)=>!!value && value.length<=max && !/[\x00-\x1f\x7f]/.test(value);
 if(!safe(input.providers.emailApiKey,512) || !safe(input.providers.emailFrom,320) || !input.publicBaseUrl){
  return {kind:"retryable",code:"provider_unconfigured"};
 }
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.recipient) ||
    !/^[a-f0-9]{64}$/.test(input.idempotencyKey) || !input.href.startsWith("/") || input.href.startsWith("//")){
  return {kind:"terminal",code:"invalid_dispatch"};
 }
 let href:string;
 try{
  const origin=new URL(input.publicBaseUrl);
  const local=origin.protocol==="http:" && ["localhost","127.0.0.1","[::1]"].includes(origin.hostname);
  if((origin.protocol!=="https:" && !local) || origin.username || origin.password || origin.origin!==input.publicBaseUrl)throw new Error();
  href=new URL(input.href,origin).href;
 }catch{return {kind:"retryable",code:"provider_unconfigured"};}
 try{
  const response=await fetcher("https://api.resend.com/emails",{
   method:"POST",redirect:"error",signal:AbortSignal.timeout(10000),
   headers:{Authorization:"Bearer "+input.providers.emailApiKey,"Content-Type":"application/json","Idempotency-Key":input.idempotencyKey},
   body:JSON.stringify({from:input.providers.emailFrom,to:[input.recipient],subject:"Interview scheduled",
    text:"An interview has been scheduled. Sign in to HSE Verify and open your record for the current time and preparation details: "+href})
  });
  if(!response.ok){
   if(response.status===409){
    const value:unknown=await response.json().catch(()=>null);
    const concurrent=value && typeof value==="object" && (value as {name?:unknown}).name==="concurrent_idempotent_requests";
    return {kind:concurrent?"retryable":"terminal",code:"provider_http_409"};
   }
   return {kind:response.status===429 || response.status>=500?"retryable":"terminal",code:"provider_http_"+response.status};
  }
  const value:unknown=await response.json();
  const reference=value && typeof value==="object" ? (value as {id?:unknown}).id:null;
  if(typeof reference!=="string" || reference.length>240 || !/^[A-Za-z0-9_-]+$/.test(reference))return {kind:"retryable",code:"provider_invalid_response"};
  return {kind:"accepted",providerReference:reference};
 }catch{return {kind:"retryable",code:"provider_unreachable"};}
}
