import { BillingAccessError,BillingConflictError,BillingInputError } from "@/lib/billing/billing-domain";
import { BillingService } from "@/lib/billing/billing-service";
import { getDatabaseClient } from "@/lib/database/database";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:Request):Promise<Response>{
  const secret=process.env.HSE_BILLING_WEBHOOK_SECRET;
  if(!secret)return Response.json({error:"Billing webhook is not configured."},{status:503});
  try{const rawBody=await request.text();if(rawBody.length>16_384)throw new BillingInputError("Webhook payload is too large.");const signature=request.headers.get("x-hse-billing-signature")??"";const result=await new BillingService(await getDatabaseClient()).ingestProviderWebhook({rawBody,signature,secret});return Response.json(result,{status:200});}
  catch(error){if(error instanceof BillingAccessError)return Response.json({error:"Webhook signature or reference is invalid."},{status:401});if(error instanceof BillingInputError||error instanceof BillingConflictError)return Response.json({error:"Webhook payload cannot be processed."},{status:400});return Response.json({error:"Webhook processing failed."},{status:500});}
}
