import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { resolveTenantPermissions } from "@/lib/authorization/authorization-domain";
import { deriveTrustedTenantScope } from "@/lib/authorization/tenant-scoped-resource-domain";
import { getWorkerAssessmentApplicationService } from "@/lib/assessment-catalogue/worker-assessment-application-service";
import { getDatabaseClient } from "@/lib/database/database";
import { BillingService } from "@/lib/billing/billing-service";
import {
  approveWorkerAssessmentFunding,
  completeSandboxCreditCheckout,
  createCreditCheckout,
  rejectWorkerAssessmentFunding,
  requestRefund,
  runReconciliation
} from "./actions";

export default async function CompanyBillingPage({searchParams}: {searchParams: Promise<{fundingError?: string}>}): Promise<React.JSX.Element> {
  const { fundingError } = await searchParams;
  const principal = await requireCurrentTenantPermission("company.billing.read");
  const scope = deriveTrustedTenantScope(principal);
  const permissions = resolveTenantPermissions(
    principal.tenantMembership.role,
    principal.tenantMembership.overrides
  );
  const canManage = permissions.has("company.billing.manage");
  const [snapshot, workerFundingRequests] = await Promise.all([
    new BillingService(await getDatabaseClient()).snapshot(principal),
    (await getWorkerAssessmentApplicationService()).listCompanyFundingRequests(scope.tenantId)
  ]);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Company operations</p>
          <h1>Company billing</h1>
          <p>
            Company credits, invoice history, refunds and reconciliation.{" "}
            <strong>Sandbox billing mode</strong> is active; no live production payment
            provider is connected.
          </p>
        </div>
      </div>

      {fundingError && <p className="status-banner status-error" role="alert">{fundingError}</p>}
      <div className="metric-grid">
        <article className="metric-card">
          <span>Company credits</span>
          <strong>{snapshot.creditBalance}</strong>
          <small>Sandbox credit ledger balance</small>
        </article>
      </div>

      <div className="card">
        <h2>Worker assessment funding requests</h2>
        <p>
          Linked Workers can request one assessment credit. Approval reserves a real Company
          credit and creates the Worker&apos;s assessment case; rejection leaves the application
          closed without creating a case.
        </p>
        {workerFundingRequests.length === 0 ? (
          <p>No Worker funding requests yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Assessment</th>
                  <th>Credits</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {workerFundingRequests.map((request) => (
                  <tr key={request.fundingRequestId}>
                    <td><code>{request.workerAccountId}</code></td>
                    <td>{request.catalogueTitle}</td>
                    <td>{request.creditUnits}</td>
                    <td>{request.status}</td>
                    <td>{request.createdAt}</td>
                    <td>
                      {request.status === "REQUESTED" && canManage ? (
                        <div className="button-row">
                          <form action={approveWorkerAssessmentFunding}>
                            <input type="hidden" name="fundingRequestId" value={request.fundingRequestId} />
                            <button className="button button-primary button-small" type="submit">Approve</button>
                          </form>
                          <form action={rejectWorkerAssessmentFunding}>
                            <input type="hidden" name="fundingRequestId" value={request.fundingRequestId} />
                            <button className="button button-secondary button-small" type="submit">Reject</button>
                          </form>
                        </div>
                      ) : request.status === "REQUESTED" ? "Manager approval required" : "Completed"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Buy sandbox credits</h2>
        <form action={createCreditCheckout} className="form-grid">
          <label>
            Credits
            <input name="creditUnits" type="number" min="1" required />
          </label>
          <label>
            Amount (minor units)
            <input name="amountMinor" type="number" min="1" required />
          </label>
          <label>
            Currency
            <input name="currency" defaultValue="USD" maxLength={3} required />
          </label>
          <input type="hidden" name="idempotencyKey" value="checkout-request" />
          <button className="button button-primary" type="submit">
            Create sandbox checkout
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Sandbox checkouts</h2>
        {snapshot.checkouts.length === 0 ? (
          <p>No checkouts yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Checkout</th>
                  <th>Status</th>
                  <th>Provider reference</th>
                  <th>Credits</th>
                  <th>Amount</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.checkouts.map((item) => (
                  <tr key={item.checkoutId}>
                    <td>{item.checkoutId}</td>
                    <td>{item.status}</td>
                    <td><code>{item.providerCheckoutReference}</code></td>
                    <td>{item.creditUnits}</td>
                    <td>{item.amountMinor} {item.currency}</td>
                    <td>
                      {item.status === "REQUIRES_PROVIDER" && canManage ? (
                        <form action={completeSandboxCreditCheckout}>
                          <input type="hidden" name="checkoutId" value={item.checkoutId} />
                          <button className="button button-primary button-small" type="submit">
                            Complete sandbox checkout
                          </button>
                        </form>
                      ) : item.status === "PAID" ? "Captured" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Invoices</h2>
        {snapshot.invoices.length === 0 ? (
          <p>No invoices yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Refunded</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.invoices.map((item) => (
                  <tr key={item.invoiceId}>
                    <td>{item.invoiceId}</td>
                    <td>{item.status}</td>
                    <td>{item.amountMinor} {item.currency}</td>
                    <td>{item.refundedAmountMinor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Refunds</h2>
        <form action={requestRefund} className="form-grid">
          <label>
            Invoice ID
            <input name="invoiceId" required />
          </label>
          <label>
            Amount (minor units)
            <input name="amountMinor" type="number" min="1" required />
          </label>
          <input type="hidden" name="idempotencyKey" value="refund-request" />
          <button className="button" type="submit">
            Request sandbox refund
          </button>
        </form>
        {snapshot.refunds.length === 0 ? (
          <p>No refunds yet.</p>
        ) : (
          <ul>
            {snapshot.refunds.map((item) => (
              <li key={item.refundId}>
                {item.refundId}: {item.status} ({item.amountMinor} {item.currency}) ·
                Provider reference: <code>{item.providerRefundReference}</code>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Reconciliation</h2>
        <p>
          Compares paid checkouts with invoice state and records discrepancies without
          rewriting financial history.
        </p>
        <form action={runReconciliation}>
          <button className="button" type="submit">Run reconciliation</button>
        </form>
        {snapshot.reconciliations.map((run) => (
          <p key={run.reconciliationRunId}>
            {run.status} — {run.items.length} discrepancy item(s)
          </p>
        ))}
      </div>
    </section>
  );
}