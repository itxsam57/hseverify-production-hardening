import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { billingId, BillingAccessError, BillingInputError } from "./billing-domain";

export type BillingProviderEvent =
  | Readonly<{ id:string; type:"payment.captured"; checkoutReference:string; amountMinor:number; currency:string }>
  | Readonly<{ id:string; type:"refund.succeeded"; refundReference:string; amountMinor:number; currency:string }>;

export function signBillingWebhook(rawBody:string, secret:string):string {
  if(secret.length<16) throw new BillingInputError("Billing webhook secret is too short.");
  return createHmac("sha256",secret).update(rawBody,"utf8").digest("hex");
}
export function billingPayloadHash(rawBody:string):string { return createHash("sha256").update(rawBody,"utf8").digest("hex"); }
export function verifyBillingWebhook(rawBody:string,signature:string,secret:string):void {
  const expected=Buffer.from(signBillingWebhook(rawBody,secret),"hex");
  let supplied:Buffer; try { supplied=Buffer.from(signature.trim(),"hex"); } catch { throw new BillingAccessError(); }
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)) throw new BillingAccessError();
}

export class SandboxBillingProvider {
  readonly mode="sandbox" as const;
  createCheckoutReference():string { return `sandbox_checkout_${billingId("billing").slice(-24)}`; }
  createRefundReference():string { return `sandbox_refund_${billingId("billing").slice(-24)}`; }
}

export function parseBillingProviderEvent(rawBody:string):BillingProviderEvent {
  let value:unknown; try { value=JSON.parse(rawBody); } catch { throw new BillingInputError("Provider webhook payload is invalid JSON."); }
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new BillingInputError("Provider webhook payload is invalid.");
  const row=value as Record<string,unknown>;
  if(typeof row.id!=="string"||row.id.trim().length<8||typeof row.type!=="string"||!Number.isSafeInteger(row.amountMinor)||typeof row.currency!=="string") throw new BillingInputError("Provider webhook payload is incomplete.");
  const base={id:row.id.trim(),amountMinor:Number(row.amountMinor),currency:row.currency.trim().toUpperCase()};
  if(base.amountMinor<=0||!/^[A-Z]{3}$/.test(base.currency)) throw new BillingInputError("Provider webhook amount or currency is invalid.");
  if(row.type==="payment.captured"&&typeof row.checkoutReference==="string"&&row.checkoutReference.trim()) return Object.freeze({...base,type:"payment.captured" as const,checkoutReference:row.checkoutReference.trim()});
  if(row.type==="refund.succeeded"&&typeof row.refundReference==="string"&&row.refundReference.trim()) return Object.freeze({...base,type:"refund.succeeded" as const,refundReference:row.refundReference.trim()});
  throw new BillingInputError("Provider webhook event type is unsupported.");
}
