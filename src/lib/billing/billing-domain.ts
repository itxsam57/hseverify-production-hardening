import { createIdentifier } from "../auth/auth-domain";

export const BILLING_READ_PERMISSION = "company.billing.read" as const;
export const BILLING_MANAGE_PERMISSION = "company.billing.manage" as const;

export class BillingAccessError extends Error {
  constructor(message = "Billing access was denied.") { super(message); this.name = "BillingAccessError"; }
}
export class BillingConflictError extends Error {
  constructor(message = "The billing operation conflicts with current state.") { super(message); this.name = "BillingConflictError"; }
}
export class BillingInputError extends Error {
  constructor(message = "Billing input is invalid.") { super(message); this.name = "BillingInputError"; }
}

export type BillingCheckout = Readonly<{
  checkoutId:string; status:"REQUIRES_PROVIDER"|"PAID"|"FAILED"; providerMode:"sandbox";
  providerCheckoutReference:string; creditUnits:number; amountMinor:number; currency:string; createdAt:string;
}>;
export type BillingInvoice = Readonly<{
  invoiceId:string; checkoutId:string; status:"OPEN"|"PAID"|"PARTIALLY_REFUNDED"|"REFUNDED";
  creditUnits:number; amountMinor:number; refundedAmountMinor:number; currency:string; createdAt:string; updatedAt:string;
}>;
export type BillingRefund = Readonly<{
  refundId:string; invoiceId:string; status:"REQUIRES_PROVIDER"|"SUCCEEDED"|"FAILED"; providerMode:"sandbox";
  providerRefundReference:string; amountMinor:number; creditUnits:number; currency:string; createdAt:string;
}>;
export type BillingLedgerEntry = Readonly<{
  ledgerEntryId:string; invoiceId:string; refundId:string|null; entryType:"PURCHASE"|"REFUND";
  creditDelta:number; amountMinor:number; currency:string; occurredAt:string;
}>;
export type BillingReconciliationItem = Readonly<{ code:string; reference:string; detail:string }>;
export type BillingReconciliationRun = Readonly<{
  reconciliationRunId:string; status:"CLEAN"|"DISCREPANCIES_FOUND"; items:readonly BillingReconciliationItem[]; createdAt:string;
}>;
export type BillingSnapshot = Readonly<{
  providerMode:"sandbox"; creditBalance:number; checkouts:readonly BillingCheckout[]; invoices:readonly BillingInvoice[];
  refunds:readonly BillingRefund[]; creditLedger:readonly BillingLedgerEntry[]; reconciliations:readonly BillingReconciliationRun[];
  activeSubscription: BillingSubscription | null; subscriptions: readonly BillingSubscription[];
}>;

export type BillingSubscription = Readonly<{
  subscriptionId:string; planCode:string; status:"ACTIVE"|"CANCELLED"; providerMode:"sandbox";
  providerSubscriptionReference:string; createdAt:string; cancelledAt:string|null;
}>;

export function billingId(prefix:string):string { return createIdentifier(prefix); }
export function normalizeCurrency(value:string):string {
  const currency=value.trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency)) throw new BillingInputError("Currency must be a three-letter code.");
  return currency;
}
export function normalizeIdempotencyKey(value:string):string {
  const key=value.trim(); if(key.length<3||key.length>160) throw new BillingInputError("Idempotency key is invalid."); return key;
}
export function positiveInteger(value:number,label:string):number {
  if(!Number.isSafeInteger(value)||value<=0) throw new BillingInputError(`${label} must be a positive integer.`); return value;
}
