import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { BillingService } from "@/lib/billing/billing-service";
import { getDatabaseClient } from "@/lib/database/database";

export const dynamic = "force-dynamic";

/**
 * Printable sandbox payment receipt, resolved exclusively from the currently
 * authenticated Company's tenant-scoped billing snapshot. No invoice ID can
 * select a different tenant or reveal whether another tenant has a receipt.
 */
export default async function CompanyBillingReceiptPage({
  params
}: {
  params: Promise<{ invoiceId: string }>;
}): Promise<React.JSX.Element> {
  const principal = await requireCurrentTenantPermission("company.billing.read");
  const { invoiceId } = await params;
  if (!/^billing_invoice_[A-Za-z0-9_-]{24}$/.test(invoiceId)) notFound();

  const snapshot = await new BillingService(await getDatabaseClient()).snapshot(principal);
  const invoice = snapshot.invoices.find((item) => item.invoiceId === invoiceId);
  if (!invoice || invoice.status === "OPEN") notFound();

  const purchase = snapshot.creditLedger.find((entry) =>
    entry.invoiceId === invoiceId && entry.entryType === "PURCHASE"
  );
  if (!purchase) notFound(); // A receipt needs a real captured ledger entry.

  const refunds = snapshot.creditLedger.filter((entry) =>
    entry.invoiceId === invoiceId && entry.entryType === "REFUND"
  );
  const tenantId = principal.tenantMembership.tenantId;
  return (
    <section className="page-stack" aria-label="Company billing receipt">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Company billing · sandbox</p>
          <h1>Payment receipt</h1>
          <p>
            Sandbox transaction confirmation only. No live card payment was taken.
            This is not a tax invoice or proof of live settlement.
          </p>
        </div>
        <Link href="/company/billing" className="button button-secondary">Back to billing</Link>
      </div>

      <div className="card content-stack">
        <h2>Captured credit purchase</h2>
        <dl>
          <dt>Company tenant</dt><dd><code>{tenantId}</code></dd>
          <dt>Invoice</dt><dd><code>{invoice.invoiceId}</code></dd>
          <dt>Checkout</dt><dd><code>{invoice.checkoutId}</code></dd>
          <dt>Invoice status</dt><dd>{invoice.status}</dd>
          <dt>Captured at</dt><dd><time dateTime={purchase.occurredAt}>{purchase.occurredAt}</time></dd>
          <dt>Purchased credits</dt><dd>{invoice.creditUnits}</dd>
          <dt>Captured amount</dt><dd>{invoice.amountMinor} {invoice.currency} (minor units)</dd>
          <dt>Refunded amount</dt><dd>{invoice.refundedAmountMinor} {invoice.currency} (minor units)</dd>
        </dl>
        {refunds.length > 0 ? (
          <>
            <h3>Refund history</h3>
            <ul>
              {refunds.map((refund) => (
                <li key={refund.ledgerEntryId}>
                  {refund.occurredAt}: {refund.creditDelta} credits, {refund.amountMinor} {refund.currency} (minor units)
                </li>
              ))}
            </ul>
          </>
        ) : <p>No successful refunds recorded for this invoice.</p>}
        <p className="muted-copy">
          Print or save this page as PDF using your browser. Invoice and refund history
          remain available in Company billing.
        </p>
      </div>
    </section>
  );
}
