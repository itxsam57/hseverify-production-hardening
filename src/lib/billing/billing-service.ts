import type { DatabaseClient } from "../database/database";
import { runTenantScopedCommand } from "../authorization/tenant-scoped-command-guard";
import type { TenantPermissionPrincipal } from "../authorization/tenant-scoped-resource-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import {
  BILLING_MANAGE_PERMISSION,BILLING_READ_PERMISSION,BillingAccessError,BillingConflictError,BillingInputError,
  billingId,normalizeCurrency,normalizeIdempotencyKey,positiveInteger,
  type BillingCheckout,type BillingInvoice,type BillingLedgerEntry,type BillingReconciliationItem,type BillingReconciliationRun,type BillingRefund,type BillingSnapshot,type BillingSubscription
} from "./billing-domain";
import { SandboxBillingProvider,billingPayloadHash,parseBillingProviderEvent,verifyBillingWebhook } from "./billing-provider";

type ManagePrincipal=TenantPermissionPrincipal<typeof BILLING_MANAGE_PERMISSION>;
type ReadPrincipal=TenantPermissionPrincipal<typeof BILLING_READ_PERMISSION>;
type CheckoutRow={checkout_id:string;status:BillingCheckout["status"];provider_mode:"sandbox";provider_checkout_reference:string;credit_units:number;amount_minor:number;currency:string;created_at:string|Date};
type InvoiceRow={invoice_id:string;checkout_id:string;status:BillingInvoice["status"];credit_units:number;amount_minor:number;refunded_amount_minor:number;currency:string;created_at:string|Date;updated_at:string|Date};
type RefundRow={refund_id:string;invoice_id:string;status:BillingRefund["status"];provider_mode:"sandbox";provider_refund_reference:string;amount_minor:number;credit_units:number;currency:string;created_at:string|Date};
type LedgerRow={ledger_entry_id:string;invoice_id:string;refund_id:string|null;entry_type:BillingLedgerEntry["entryType"];credit_delta:number;amount_minor:number;currency:string;occurred_at:string|Date};
type ProviderEventRow={provider_event_id:string;event_type:"payment.captured"|"refund.succeeded";provider_reference:string;amount_minor:number;currency:string;payload_sha256:string};
type ReconciliationCheckoutRow=CheckoutRow&{tenant_id:string};
type ReconciliationInvoiceRow=InvoiceRow&{tenant_id:string};
type ReconciliationRefundRow=RefundRow&{tenant_id:string};
type ReconciliationLedgerRow=LedgerRow&{provider_event_id:string};
type SubscriptionRow={subscription_id:string;plan_code:string;status:BillingSubscription["status"];provider_mode:"sandbox";provider_subscription_reference:string;created_at:string|Date;cancelled_at:string|Date|null};
const iso=(value:string|Date)=>value instanceof Date?value.toISOString():new Date(value).toISOString();
const checkout=(r:CheckoutRow):BillingCheckout=>Object.freeze({checkoutId:r.checkout_id,status:r.status,providerMode:r.provider_mode,providerCheckoutReference:r.provider_checkout_reference,creditUnits:Number(r.credit_units),amountMinor:Number(r.amount_minor),currency:r.currency,createdAt:iso(r.created_at)});
const invoice=(r:InvoiceRow):BillingInvoice=>Object.freeze({invoiceId:r.invoice_id,checkoutId:r.checkout_id,status:r.status,creditUnits:Number(r.credit_units),amountMinor:Number(r.amount_minor),refundedAmountMinor:Number(r.refunded_amount_minor),currency:r.currency,createdAt:iso(r.created_at),updatedAt:iso(r.updated_at)});
const refund=(r:RefundRow):BillingRefund=>Object.freeze({refundId:r.refund_id,invoiceId:r.invoice_id,status:r.status,providerMode:r.provider_mode,providerRefundReference:r.provider_refund_reference,amountMinor:Number(r.amount_minor),creditUnits:Number(r.credit_units),currency:r.currency,createdAt:iso(r.created_at)});
const ledger=(r:LedgerRow):BillingLedgerEntry=>Object.freeze({ledgerEntryId:r.ledger_entry_id,invoiceId:r.invoice_id,refundId:r.refund_id,entryType:r.entry_type,creditDelta:Number(r.credit_delta),amountMinor:Number(r.amount_minor),currency:r.currency,occurredAt:iso(r.occurred_at)});
const reconciliationItem=(item:{code:string;reference:string;detail:string}):BillingReconciliationItem=>Object.freeze({code:item.code,reference:item.reference,detail:item.detail});
const subscription=(r:SubscriptionRow):BillingSubscription=>Object.freeze({subscriptionId:r.subscription_id,planCode:r.plan_code,status:r.status,providerMode:r.provider_mode,providerSubscriptionReference:r.provider_subscription_reference,createdAt:iso(r.created_at),cancelledAt:r.cancelled_at?iso(r.cancelled_at):null});

function providerEventMatches(row:ProviderEventRow,event:{type:"payment.captured"|"refund.succeeded";amountMinor:number;currency:string},providerReference:string,payloadHash:string):boolean{
  return row.event_type===event.type&&row.provider_reference===providerReference&&Number(row.amount_minor)===event.amountMinor&&row.currency===event.currency&&row.payload_sha256===payloadHash;
}

export class BillingService {
  constructor(private readonly database:DatabaseClient,private readonly provider:SandboxBillingProvider=new SandboxBillingProvider()){}

  private async audit(database:DatabaseClient,principal:ManagePrincipal,action:"billing.checkout.created"|"billing.refund.requested"|"billing.reconciliation.completed"|"billing.subscription.started"|"billing.subscription.cancelled",reference:string,metadata:Record<string,unknown>):Promise<void>{
    await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action,outcome:"succeeded",target:{type:"resource",reference},metadata});
  }

  async startSubscription(principal:ManagePrincipal,input:{idempotencyKey:string;planCode:string},now=new Date()):Promise<BillingSubscription>{
    const key=normalizeIdempotencyKey(input.idempotencyKey),planCode=input.planCode.trim();
    if(!planCode) throw new BillingInputError("Plan code is required.");
    return runTenantScopedCommand({database:this.database,principal,permission:BILLING_MANAGE_PERMISSION,now,operation:async({database,scope})=>{
      const existing=await database.query<SubscriptionRow>(`SELECT * FROM billing_subscriptions WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE`,[scope.tenantId,key]);
      if(existing.rows[0]) return subscription(existing.rows[0]);
      const id=billingId("billing_subscription"), timestamp=now.toISOString(), providerReference=`sandbox_subscription_${id.slice(-24)}`;
      await database.query(`INSERT INTO billing_subscriptions(subscription_id,tenant_id,idempotency_key,plan_code,status,provider_mode,provider_subscription_reference,created_at) VALUES($1,$2,$3,$4,'ACTIVE','sandbox',$5,$6)`,[id,scope.tenantId,key,planCode,providerReference,timestamp]);
      await this.audit(database,principal,"billing.subscription.started",id,{planCode,providerMode:"sandbox"});
      return subscription({subscription_id:id,plan_code:planCode,status:"ACTIVE",provider_mode:"sandbox",provider_subscription_reference:providerReference,created_at:timestamp,cancelled_at:null});
    }});
  }

  async cancelSubscription(principal:ManagePrincipal,input:{subscriptionId:string},now=new Date()):Promise<BillingSubscription>{
    return runTenantScopedCommand({database:this.database,principal,permission:BILLING_MANAGE_PERMISSION,now,operation:async({database,scope})=>{
      const found=await database.query<SubscriptionRow>(`SELECT * FROM billing_subscriptions WHERE tenant_id=$1 AND subscription_id=$2 FOR UPDATE`,[scope.tenantId,input.subscriptionId]);
      if(!found.rows[0]) throw new BillingAccessError();
      await database.query(`UPDATE billing_subscriptions SET status='CANCELLED',cancelled_at=$3 WHERE tenant_id=$1 AND subscription_id=$2`,[scope.tenantId,input.subscriptionId,now.toISOString()]);
      await this.audit(database,principal,"billing.subscription.cancelled",input.subscriptionId,{});
      return subscription({...found.rows[0],status:"CANCELLED",cancelled_at:now.toISOString()});
    }});
  }

  async createCreditCheckout(principal:ManagePrincipal,input:{idempotencyKey:string;creditUnits:number;amountMinor:number;currency:string},now=new Date()):Promise<BillingCheckout>{
    const key=normalizeIdempotencyKey(input.idempotencyKey), credits=positiveInteger(input.creditUnits,"Credit units"), amount=positiveInteger(input.amountMinor,"Amount"), currency=normalizeCurrency(input.currency);
    if(amount%credits!==0) throw new BillingInputError("Amount must resolve to a whole minor-unit price per credit.");
    try{return await runTenantScopedCommand({database:this.database,principal,permission:BILLING_MANAGE_PERMISSION,now,operation:async({database,scope})=>{
      const existing=await database.query<CheckoutRow>(`SELECT checkout_id,status,provider_mode,provider_checkout_reference,credit_units,amount_minor,currency,created_at FROM billing_checkouts WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE`,[scope.tenantId,key]);
      if(existing.rows[0]){const row=existing.rows[0];if(Number(row.credit_units)!==credits||Number(row.amount_minor)!==amount||row.currency!==currency)throw new BillingConflictError("Idempotency key was already used for different checkout data.");return checkout(row);}
      const checkoutId=billingId("billing_checkout"), invoiceId=billingId("billing_invoice"), providerReference=this.provider.createCheckoutReference(),timestamp=now.toISOString();
      await database.query(`INSERT INTO billing_checkouts(checkout_id,tenant_id,idempotency_key,credit_units,amount_minor,currency,provider_mode,provider_checkout_reference,status,created_by_membership_id,created_at) VALUES($1,$2,$3,$4,$5,$6,'sandbox',$7,'REQUIRES_PROVIDER',$8,$9)`,[checkoutId,scope.tenantId,key,credits,amount,currency,providerReference,scope.membershipId,timestamp]);
      await database.query(`INSERT INTO billing_invoices(invoice_id,tenant_id,checkout_id,credit_units,amount_minor,currency,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'OPEN',$7,$7)`,[invoiceId,scope.tenantId,checkoutId,credits,amount,currency,timestamp]);
      await this.audit(database,principal,"billing.checkout.created",checkoutId,{invoiceId,creditUnits:credits,amountMinor:amount,currency,providerMode:"sandbox"});
      return Object.freeze({checkoutId,status:"REQUIRES_PROVIDER" as const,providerMode:"sandbox" as const,providerCheckoutReference:providerReference,creditUnits:credits,amountMinor:amount,currency,createdAt:timestamp});
    }});}catch(error){if(error instanceof BillingInputError||error instanceof BillingConflictError)throw error; if((error as Error)?.name?.includes("TenantScope"))throw new BillingAccessError(); throw error;}
  }

  async requestRefund(principal:ManagePrincipal,input:{invoiceId:string;idempotencyKey:string;amountMinor:number},now=new Date()):Promise<BillingRefund>{
    const invoiceId=input.invoiceId.trim(), key=normalizeIdempotencyKey(input.idempotencyKey), amount=positiveInteger(input.amountMinor,"Refund amount"); if(!invoiceId)throw new BillingInputError("Invoice is required.");
    try{return await runTenantScopedCommand({database:this.database,principal,permission:BILLING_MANAGE_PERMISSION,now,operation:async({database,scope})=>{
      const prior=await database.query<RefundRow>(`SELECT refund_id,invoice_id,status,provider_mode,provider_refund_reference,amount_minor,credit_units,currency,created_at FROM billing_refunds WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE`,[scope.tenantId,key]);
      if(prior.rows[0]){if(prior.rows[0].invoice_id!==invoiceId||Number(prior.rows[0].amount_minor)!==amount)throw new BillingConflictError("Idempotency key was already used for different refund data.");return refund(prior.rows[0]);}
      const found=await database.query<InvoiceRow>(`SELECT invoice_id,checkout_id,status,credit_units,amount_minor,refunded_amount_minor,currency,created_at,updated_at FROM billing_invoices WHERE tenant_id=$1 AND invoice_id=$2 FOR UPDATE`,[scope.tenantId,invoiceId]); const inv=found.rows[0]; if(!inv)throw new BillingAccessError(); if(inv.status!=="PAID"&&inv.status!=="PARTIALLY_REFUNDED")throw new BillingConflictError("Only a paid invoice can be refunded.");
      const unitPrice=Number(inv.amount_minor)/Number(inv.credit_units); if(!Number.isSafeInteger(unitPrice)||amount%unitPrice!==0)throw new BillingInputError("Refund amount must equal a whole number of purchased credits.");
      const reserved=await database.query<{total:number|string}>(`SELECT COALESCE(SUM(amount_minor),0) AS total FROM billing_refunds WHERE tenant_id=$1 AND invoice_id=$2 AND status IN ('REQUIRES_PROVIDER','SUCCEEDED')`,[scope.tenantId,invoiceId]); if(Number(reserved.rows[0]?.total??0)+amount>Number(inv.amount_minor))throw new BillingConflictError("Refund exceeds the invoice refundable amount.");
      const creditUnits=amount/unitPrice, refundId=billingId("billing_refund"), providerReference=this.provider.createRefundReference(),timestamp=now.toISOString();
      await database.query(`INSERT INTO billing_refunds(refund_id,tenant_id,invoice_id,idempotency_key,amount_minor,credit_units,currency,provider_mode,provider_refund_reference,status,created_by_membership_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'sandbox',$8,'REQUIRES_PROVIDER',$9,$10)`,[refundId,scope.tenantId,invoiceId,key,amount,creditUnits,inv.currency,providerReference,scope.membershipId,timestamp]);
      await this.audit(database,principal,"billing.refund.requested",refundId,{invoiceId,amountMinor:amount,creditUnits,currency:inv.currency,providerMode:"sandbox"});
      return Object.freeze({refundId,invoiceId,status:"REQUIRES_PROVIDER" as const,providerMode:"sandbox" as const,providerRefundReference:providerReference,amountMinor:amount,creditUnits,currency:inv.currency,createdAt:timestamp});
    }});}catch(error){if(error instanceof BillingInputError||error instanceof BillingConflictError||error instanceof BillingAccessError)throw error;if((error as Error)?.name?.includes("TenantScope"))throw new BillingAccessError();throw error;}
  }

  async ingestProviderWebhook(input:{rawBody:string;signature:string;secret:string;now?:Date}):Promise<Readonly<{processed:boolean;duplicate:boolean}>>{
    verifyBillingWebhook(input.rawBody,input.signature,input.secret); const event=parseBillingProviderEvent(input.rawBody),now=input.now??new Date(),payloadHash=billingPayloadHash(input.rawBody);
    return this.database.transaction(async database=>{
      const providerReference=event.type==="payment.captured"?event.checkoutReference:event.refundReference;
      const seen=await database.query<ProviderEventRow>(`SELECT provider_event_id,event_type,provider_reference,amount_minor,currency,payload_sha256 FROM billing_provider_events WHERE provider_event_id=$1`,[event.id]);
      if(seen.rows[0]){
        if(!providerEventMatches(seen.rows[0],event,providerReference,payloadHash))throw new BillingConflictError("Provider event ID was replayed with different payload data.");
        return Object.freeze({processed:false,duplicate:true});
      }
      if(event.type==="payment.captured"){
        const rows=await database.query<{checkout_id:string;tenant_id:string;invoice_id:string;status:string;credit_units:number;amount_minor:number;currency:string}>(`SELECT c.checkout_id,c.tenant_id,i.invoice_id,c.status,c.credit_units,c.amount_minor,c.currency FROM billing_checkouts c JOIN billing_invoices i ON i.checkout_id=c.checkout_id AND i.tenant_id=c.tenant_id WHERE c.provider_checkout_reference=$1 FOR UPDATE OF c,i`,[event.checkoutReference]); const row=rows.rows[0]; if(!row)throw new BillingAccessError(); if(Number(row.amount_minor)!==event.amountMinor||row.currency!==event.currency)throw new BillingConflictError("Provider capture does not match checkout amount or currency.");
        const inserted=await database.query<{provider_event_id:string}>(`INSERT INTO billing_provider_events(provider_event_id,tenant_id,event_type,provider_reference,amount_minor,currency,payload_sha256,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (provider_event_id) DO NOTHING RETURNING provider_event_id`,[event.id,row.tenant_id,event.type,event.checkoutReference,event.amountMinor,event.currency,payloadHash,now.toISOString()]);
        if(!inserted.rows[0]){const raced=await database.query<ProviderEventRow>(`SELECT provider_event_id,event_type,provider_reference,amount_minor,currency,payload_sha256 FROM billing_provider_events WHERE provider_event_id=$1`,[event.id]);if(!raced.rows[0]||!providerEventMatches(raced.rows[0],event,event.checkoutReference,payloadHash))throw new BillingConflictError("Provider event ID was replayed with different payload data.");return Object.freeze({processed:false,duplicate:true});}
        if(row.status==="PAID")return Object.freeze({processed:false,duplicate:true}); if(row.status!=="REQUIRES_PROVIDER")throw new BillingConflictError("Checkout cannot be captured from its current state.");
        await database.query(`UPDATE billing_checkouts SET status='PAID',captured_at=$3 WHERE tenant_id=$1 AND checkout_id=$2`,[row.tenant_id,row.checkout_id,now.toISOString()]); await database.query(`UPDATE billing_invoices SET status='PAID',paid_at=$3,updated_at=$3 WHERE tenant_id=$1 AND invoice_id=$2`,[row.tenant_id,row.invoice_id,now.toISOString()]);
        await database.query(`INSERT INTO billing_credit_ledger(ledger_entry_id,tenant_id,invoice_id,refund_id,provider_event_id,entry_type,credit_delta,amount_minor,currency,occurred_at) VALUES($1,$2,$3,NULL,$4,'PURCHASE',$5,$6,$7,$8)`,[billingId("billing_ledger"),row.tenant_id,row.invoice_id,event.id,Number(row.credit_units),event.amountMinor,event.currency,now.toISOString()]); return Object.freeze({processed:true,duplicate:false});
      }
      const rows=await database.query<{refund_id:string;tenant_id:string;invoice_id:string;status:string;credit_units:number;amount_minor:number;currency:string;invoice_amount:number;refunded_amount:number}>(`SELECT r.refund_id,r.tenant_id,r.invoice_id,r.status,r.credit_units,r.amount_minor,r.currency,i.amount_minor AS invoice_amount,i.refunded_amount_minor AS refunded_amount FROM billing_refunds r JOIN billing_invoices i ON i.invoice_id=r.invoice_id AND i.tenant_id=r.tenant_id WHERE r.provider_refund_reference=$1 FOR UPDATE OF r,i`,[event.refundReference]); const row=rows.rows[0]; if(!row)throw new BillingAccessError(); if(Number(row.amount_minor)!==event.amountMinor||row.currency!==event.currency)throw new BillingConflictError("Provider refund does not match requested amount or currency.");
      const inserted=await database.query<{provider_event_id:string}>(`INSERT INTO billing_provider_events(provider_event_id,tenant_id,event_type,provider_reference,amount_minor,currency,payload_sha256,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (provider_event_id) DO NOTHING RETURNING provider_event_id`,[event.id,row.tenant_id,event.type,event.refundReference,event.amountMinor,event.currency,payloadHash,now.toISOString()]); if(!inserted.rows[0]){const raced=await database.query<ProviderEventRow>(`SELECT provider_event_id,event_type,provider_reference,amount_minor,currency,payload_sha256 FROM billing_provider_events WHERE provider_event_id=$1`,[event.id]);if(!raced.rows[0]||!providerEventMatches(raced.rows[0],event,event.refundReference,payloadHash))throw new BillingConflictError("Provider event ID was replayed with different payload data.");return Object.freeze({processed:false,duplicate:true});} if(row.status==="SUCCEEDED")return Object.freeze({processed:false,duplicate:true}); if(row.status!=="REQUIRES_PROVIDER")throw new BillingConflictError("Refund cannot succeed from its current state.");
      const nextRefunded=Number(row.refunded_amount)+event.amountMinor, invoiceStatus=nextRefunded===Number(row.invoice_amount)?"REFUNDED":"PARTIALLY_REFUNDED"; await database.query(`UPDATE billing_refunds SET status='SUCCEEDED',succeeded_at=$3 WHERE tenant_id=$1 AND refund_id=$2`,[row.tenant_id,row.refund_id,now.toISOString()]); await database.query(`UPDATE billing_invoices SET status=$3,refunded_amount_minor=$4,updated_at=$5 WHERE tenant_id=$1 AND invoice_id=$2`,[row.tenant_id,row.invoice_id,invoiceStatus,nextRefunded,now.toISOString()]); await database.query(`INSERT INTO billing_credit_ledger(ledger_entry_id,tenant_id,invoice_id,refund_id,provider_event_id,entry_type,credit_delta,amount_minor,currency,occurred_at) VALUES($1,$2,$3,$4,$5,'REFUND',$6,$7,$8,$9)`,[billingId("billing_ledger"),row.tenant_id,row.invoice_id,row.refund_id,event.id,-Number(row.credit_units),event.amountMinor,event.currency,now.toISOString()]); return Object.freeze({processed:true,duplicate:false});
    });
  }

  async runReconciliation(principal:ManagePrincipal,now=new Date()):Promise<BillingReconciliationRun>{
    try{return await runTenantScopedCommand({database:this.database,principal,permission:BILLING_MANAGE_PERMISSION,now,operation:async({database,scope})=>{
      const [checkoutRows,invoiceRows,refundRows,eventRows,ledgerRows]=await Promise.all([
        database.query<ReconciliationCheckoutRow>(`SELECT checkout_id,tenant_id,status,provider_mode,provider_checkout_reference,credit_units,amount_minor,currency,created_at FROM billing_checkouts WHERE tenant_id=$1 ORDER BY checkout_id`,[scope.tenantId]),
        database.query<ReconciliationInvoiceRow>(`SELECT invoice_id,tenant_id,checkout_id,status,credit_units,amount_minor,refunded_amount_minor,currency,created_at,updated_at FROM billing_invoices WHERE tenant_id=$1 ORDER BY invoice_id`,[scope.tenantId]),
        database.query<ReconciliationRefundRow>(`SELECT refund_id,tenant_id,invoice_id,status,provider_mode,provider_refund_reference,amount_minor,credit_units,currency,created_at FROM billing_refunds WHERE tenant_id=$1 ORDER BY refund_id`,[scope.tenantId]),
        database.query<ProviderEventRow>(`SELECT provider_event_id,event_type,provider_reference,amount_minor,currency,payload_sha256 FROM billing_provider_events WHERE tenant_id=$1 ORDER BY provider_event_id`,[scope.tenantId]),
        database.query<ReconciliationLedgerRow>(`SELECT ledger_entry_id,invoice_id,refund_id,provider_event_id,entry_type,credit_delta,amount_minor,currency,occurred_at FROM billing_credit_ledger WHERE tenant_id=$1 ORDER BY ledger_entry_id`,[scope.tenantId])
      ]);
      const items:Array<{code:string;reference:string;detail:string}>=[];
      const invoicesByCheckout=new Map(invoiceRows.rows.map(row=>[row.checkout_id,row]));
      const checkoutsByProviderReference=new Map(checkoutRows.rows.map(row=>[row.provider_checkout_reference,row]));
      const refundsByProviderReference=new Map(refundRows.rows.map(row=>[row.provider_refund_reference,row]));
      const eventsByProviderReference=new Map(eventRows.rows.map(row=>[`${row.event_type}:${row.provider_reference}`,row]));
      const purchaseLedgersByInvoice=new Map<string,ReconciliationLedgerRow[]>();
      const refundLedgersByRefund=new Map<string,ReconciliationLedgerRow[]>();
      for(const row of ledgerRows.rows){
        if(row.entry_type==="PURCHASE")purchaseLedgersByInvoice.set(row.invoice_id,[...(purchaseLedgersByInvoice.get(row.invoice_id)??[]),row]);
        else if(row.refund_id)refundLedgersByRefund.set(row.refund_id,[...(refundLedgersByRefund.get(row.refund_id)??[]),row]);
      }
      const add=(code:string,reference:string,detail:string):void=>{items.push({code,reference,detail});};

      for(const row of checkoutRows.rows){
        const inv=invoicesByCheckout.get(row.checkout_id);
        if(!inv){add("CHECKOUT_INVOICE_MISSING",row.checkout_id,"Checkout has no matching invoice.");continue;}
        if(Number(inv.credit_units)!==Number(row.credit_units)||Number(inv.amount_minor)!==Number(row.amount_minor)||inv.currency!==row.currency)add("CHECKOUT_INVOICE_TOTAL_MISMATCH",inv.invoice_id,`Invoice totals do not match checkout ${row.checkout_id}.`);
        if(row.status==="PAID"){
          if(!["PAID","PARTIALLY_REFUNDED","REFUNDED"].includes(inv.status))add("PAID_CHECKOUT_INVOICE_MISMATCH",inv.invoice_id,`Paid checkout ${row.checkout_id} has invoice status ${inv.status}.`);
          if(!eventsByProviderReference.has(`payment.captured:${row.provider_checkout_reference}`))add("PAID_CHECKOUT_CAPTURE_EVENT_MISSING",row.checkout_id,"Paid checkout has no stored provider capture event.");
        }
      }

      for(const providerEvent of eventRows.rows){
        if(providerEvent.event_type==="payment.captured"){
          const checkoutRow=checkoutsByProviderReference.get(providerEvent.provider_reference);
          if(!checkoutRow){add("ORPHAN_PROVIDER_EVENT",providerEvent.provider_event_id,`Capture event references unknown checkout ${providerEvent.provider_reference}.`);continue;}
          const inv=invoicesByCheckout.get(checkoutRow.checkout_id);
          const ledgerEntries=inv?purchaseLedgersByInvoice.get(inv.invoice_id)??[]:[];
          const ledgerEntry=ledgerEntries[0];
          if(Number(providerEvent.amount_minor)!==Number(checkoutRow.amount_minor)||providerEvent.currency!==checkoutRow.currency)add("PROVIDER_CAPTURE_MISMATCH",providerEvent.provider_event_id,"Capture event amount or currency does not match checkout.");
          if(!inv||ledgerEntries.length!==1||!ledgerEntry||ledgerEntry.refund_id!==null||Number(ledgerEntry.credit_delta)!==Number(checkoutRow.credit_units)||Number(ledgerEntry.amount_minor)!==Number(providerEvent.amount_minor)||ledgerEntry.currency!==providerEvent.currency)add("PURCHASE_LEDGER_MISMATCH",providerEvent.provider_event_id,"Captured checkout does not have exactly one matching purchase ledger entry.");
          continue;
        }
        const refundRow=refundsByProviderReference.get(providerEvent.provider_reference);
        if(!refundRow){add("ORPHAN_PROVIDER_EVENT",providerEvent.provider_event_id,`Refund event references unknown refund ${providerEvent.provider_reference}.`);continue;}
        const ledgerEntries=refundLedgersByRefund.get(refundRow.refund_id)??[];
        const ledgerEntry=ledgerEntries[0];
        if(Number(providerEvent.amount_minor)!==Number(refundRow.amount_minor)||providerEvent.currency!==refundRow.currency)add("PROVIDER_REFUND_MISMATCH",providerEvent.provider_event_id,"Refund event amount or currency does not match refund request.");
        if(ledgerEntries.length!==1||!ledgerEntry||ledgerEntry.invoice_id!==refundRow.invoice_id||Number(ledgerEntry.credit_delta)!==-Number(refundRow.credit_units)||Number(ledgerEntry.amount_minor)!==Number(providerEvent.amount_minor)||ledgerEntry.currency!==providerEvent.currency)add("REFUND_LEDGER_MISMATCH",providerEvent.provider_event_id,"Succeeded refund does not have exactly one matching refund ledger entry.");
      }

      for(const refundRow of refundRows.rows){
        if(refundRow.status==="SUCCEEDED"&&!eventsByProviderReference.has(`refund.succeeded:${refundRow.provider_refund_reference}`))add("SUCCEEDED_REFUND_EVENT_MISSING",refundRow.refund_id,"Succeeded refund has no stored provider success event.");
      }

      let invoiceDerivedCredits=0;
      for(const inv of invoiceRows.rows){
        const succeeded=refundRows.rows.filter(row=>row.invoice_id===inv.invoice_id&&row.status==="SUCCEEDED");
        const refundedAmount=succeeded.reduce((sum,row)=>sum+Number(row.amount_minor),0);
        if(refundedAmount!==Number(inv.refunded_amount_minor))add("REFUND_TOTAL_MISMATCH",inv.invoice_id,`Invoice records ${Number(inv.refunded_amount_minor)} refunded minor units but successful refunds total ${refundedAmount}.`);
        if(["PAID","PARTIALLY_REFUNDED","REFUNDED"].includes(inv.status)){
          const unitPrice=Number(inv.amount_minor)/Number(inv.credit_units);
          if(!Number.isSafeInteger(unitPrice)||Number(inv.refunded_amount_minor)%unitPrice!==0)add("INVOICE_CREDIT_TOTAL_MISMATCH",inv.invoice_id,"Invoice refunded amount cannot be reconciled to whole credits.");
          else invoiceDerivedCredits+=Number(inv.credit_units)-(Number(inv.refunded_amount_minor)/unitPrice);
        }
      }
      const ledgerDerivedCredits=ledgerRows.rows.reduce((sum,row)=>sum+Number(row.credit_delta),0);
      if(ledgerDerivedCredits!==invoiceDerivedCredits)add("CREDIT_LEDGER_HISTORY_MISMATCH",scope.tenantId,`Credit ledger balance ${ledgerDerivedCredits} does not match invoice-derived balance ${invoiceDerivedCredits}.`);

      const status=items.length?"DISCREPANCIES_FOUND" as const:"CLEAN" as const,runId=billingId("billing_reconcile"),timestamp=now.toISOString();
      await database.query(`INSERT INTO billing_reconciliation_runs(reconciliation_run_id,tenant_id,status,created_by_membership_id,created_at) VALUES($1,$2,$3,$4,$5)`,[runId,scope.tenantId,status,scope.membershipId,timestamp]);
      for(const item of items)await database.query(`INSERT INTO billing_reconciliation_items(reconciliation_item_id,reconciliation_run_id,tenant_id,code,reference,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[billingId("billing_reconcile_item"),runId,scope.tenantId,item.code,item.reference,item.detail,timestamp]);
      await this.audit(database,principal,"billing.reconciliation.completed",runId,{status,discrepancyCount:items.length});
      return Object.freeze({reconciliationRunId:runId,status,items:Object.freeze(items.map(reconciliationItem)),createdAt:timestamp});
    }});}catch(error){if((error as Error)?.name?.includes("TenantScope"))throw new BillingAccessError();throw error;}
  }

  async snapshot(principal:ReadPrincipal):Promise<BillingSnapshot>{
    try{return await runTenantScopedCommand({database:this.database,principal,permission:BILLING_READ_PERMISSION,operation:async({database,scope})=>{const [checkouts,invoices,refunds,ledgerRows,runs,itemRows,subscriptions]=await Promise.all([
      database.query<CheckoutRow>(`SELECT checkout_id,status,provider_mode,provider_checkout_reference,credit_units,amount_minor,currency,created_at FROM billing_checkouts WHERE tenant_id=$1 ORDER BY created_at DESC`,[scope.tenantId]),database.query<InvoiceRow>(`SELECT invoice_id,checkout_id,status,credit_units,amount_minor,refunded_amount_minor,currency,created_at,updated_at FROM billing_invoices WHERE tenant_id=$1 ORDER BY created_at DESC`,[scope.tenantId]),database.query<RefundRow>(`SELECT refund_id,invoice_id,status,provider_mode,provider_refund_reference,amount_minor,credit_units,currency,created_at FROM billing_refunds WHERE tenant_id=$1 ORDER BY created_at DESC`,[scope.tenantId]),database.query<LedgerRow>(`SELECT ledger_entry_id,invoice_id,refund_id,entry_type,credit_delta,amount_minor,currency,occurred_at FROM billing_credit_ledger WHERE tenant_id=$1 ORDER BY occurred_at DESC`,[scope.tenantId]),database.query<{reconciliation_run_id:string;status:"CLEAN"|"DISCREPANCIES_FOUND";created_at:string|Date}>(`SELECT reconciliation_run_id,status,created_at FROM billing_reconciliation_runs WHERE tenant_id=$1 ORDER BY created_at DESC`,[scope.tenantId]),database.query<{reconciliation_run_id:string;code:string;reference:string;detail:string}>(`SELECT reconciliation_run_id,code,reference,detail FROM billing_reconciliation_items WHERE tenant_id=$1 ORDER BY created_at`,[scope.tenantId]),database.query<SubscriptionRow>(`SELECT * FROM billing_subscriptions WHERE tenant_id=$1 ORDER BY created_at DESC`,[scope.tenantId])]); const entries=ledgerRows.rows.map(ledger); const subscriptionRows=subscriptions.rows.map(subscription); return Object.freeze({providerMode:"sandbox" as const,creditBalance:entries.reduce((sum,item)=>sum+item.creditDelta,0),checkouts:Object.freeze(checkouts.rows.map(checkout)),invoices:Object.freeze(invoices.rows.map(invoice)),refunds:Object.freeze(refunds.rows.map(refund)),creditLedger:Object.freeze(entries),reconciliations:Object.freeze(runs.rows.map(row=>Object.freeze({reconciliationRunId:row.reconciliation_run_id,status:row.status,items:Object.freeze(itemRows.rows.filter(item=>item.reconciliation_run_id===row.reconciliation_run_id).map(reconciliationItem)),createdAt:iso(row.created_at)}))),subscriptions:Object.freeze(subscriptionRows),activeSubscription:subscriptionRows.find((item)=>item.status==="ACTIVE")??null });}});}catch(error){if((error as Error)?.name?.includes("TenantScope"))throw new BillingAccessError();throw error;}
  }
}
