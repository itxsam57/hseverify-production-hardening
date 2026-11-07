import type {OtpProviderConfig} from "../auth/otp-provider-transport";
export type ReportEmailResult =
 | Readonly<{kind:"accepted";providerReference:string}>
 | Readonly<{kind:"retryable" | "terminal";code:string}>;
export async function sendReportEmail(input:Readonly<{
 providers:OtpProviderConfig;publicBaseUrl?:string;recipient:string;href:string;idempotencyKey:string;
}>,fetcher:typeof fetch=fetch):Promise<ReportEmailResult>{
 const safe=(value:string|undefined,max:number)=>!!value && value.length<=max && !/[\x00-\x1f\x7f]/.test(value);
 if(!safe(input.providers.emailApiKey,512) || !safe(input.providers.emailFrom,320) || !input.publicBaseUrl){
  return {kind:"retryable",code:"provider_unconfigured"};
 }
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.recipient) ||
    !/^[a-f0-9]{64}$/.test(input.idempotencyKey) || !/^\/api\/(company|worker)\/reports\/report_[A-Za-z0-9_-]{3,80}\/export$/.test(input.href)){
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
   body:JSON.stringify({from:input.providers.emailFrom,to:[input.recipient],subject:"Your HSE Verify report is ready",
    text:"Your requested report is ready. Sign in to HSE Verify to download your report: "+href})
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
