"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ShareLinkView = {
  shareLinkId: string;
  purpose: string;
  fields: readonly string[];
  expiresAt: string | null;
  revokedAt: string | null;
};

export function ShareLinkManager({ links }: { links: readonly ShareLinkView[] }): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function createLink(formData: FormData): Promise<void> {
    setBusy("create");
    setFeedback(null);
    const expiresInDays = Number(formData.get("expiresInDays") ?? 30);
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
    const response = await fetch("/api/share-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: formData.get("purpose"),
        employerDetail: formData.get("employerDetail") || undefined,
        fields: formData.getAll("fields"),
        createdAt: new Date().toISOString(),
        expiresAt
      })
    });
    setBusy(null);
    if (!response.ok) {
      setFeedback({ kind: "error", text: "The share link could not be created. Check the selected details and try again." });
      return;
    }
    setFeedback({ kind: "success", text: "Share link created. It is now listed below." });
    router.refresh();
  }

  async function revokeLink(shareLinkId: string): Promise<void> {
    setBusy(shareLinkId);
    setFeedback(null);
    const response = await fetch("/api/share-links", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shareLinkId, revokedAt: new Date().toISOString() })
    });
    setBusy(null);
    if (!response.ok) {
      setFeedback({ kind: "error", text: "The share link could not be revoked. Please try again." });
      return;
    }
    setFeedback({ kind: "success", text: "Share link revoked. Existing access is now blocked." });
    router.refresh();
  }

  return (
    <>
      <form className="dashboard-section auth-form" action={(formData) => void createLink(formData)}>
        <div>
          <p className="section-kicker">Controlled disclosure</p>
          <h2>Create a share link</h2>
          <p className="muted-copy">Choose exactly what the recipient may see. Every access is recorded.</p>
        </div>
        <div className="field-group">
          <label htmlFor="share-purpose">Purpose</label>
          <input id="share-purpose" name="purpose" required maxLength={160} placeholder="For example: site onboarding review" />
        </div>
        <div className="field-group">
          <label htmlFor="share-recipient">Recipient or employer (optional)</label>
          <input id="share-recipient" name="employerDetail" maxLength={160} placeholder="Company or reviewer name" />
        </div>
        <fieldset className="field-group">
          <legend>Information to share</legend>
          <label><input name="fields" type="checkbox" value="worker_id" defaultChecked /> Worker ID</label>
          <label><input name="fields" type="checkbox" value="qualifications" defaultChecked /> Qualifications</label>
          <label><input name="fields" type="checkbox" value="employment" /> Employment record</label>
        </fieldset>
        <div className="field-group">
          <label htmlFor="share-expiry">Link expiry</label>
          <select id="share-expiry" name="expiresInDays" defaultValue="30">
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </div>
        <button className="button button-primary" disabled={busy !== null} type="submit">
          {busy === "create" ? "Creating…" : "Create secure link"}
        </button>
      </form>

      {feedback ? (
        <p className={`form-alert ${feedback.kind === "error" ? "form-alert-error" : "form-alert-success"}`} role="status">
          {feedback.text}
        </p>
      ) : null}

      <section className="dashboard-section" aria-labelledby="active-share-links">
        <div className="section-heading-row">
          <div>
            <p className="section-kicker">Access control</p>
            <h2 id="active-share-links">Your share links</h2>
          </div>
          <span className="status-badge status-neutral">{links.length} total</span>
        </div>
        {links.length ? (
          <div className="record-list">
            {links.map((link) => {
              const active = !link.revokedAt && (!link.expiresAt || new Date(link.expiresAt) > new Date());
              return (
                <article className="record-row" key={link.shareLinkId}>
                  <div>
                    <h3>{link.purpose}</h3>
                    <p>{link.fields.join(", ")} · Expires {link.expiresAt ? new Date(link.expiresAt).toLocaleDateString() : "never"}</p>
                  </div>
                  <div className="worker-id-actions">
                    <span className={`status-badge ${active ? "status-positive" : "status-neutral"}`}>
                      {link.revokedAt ? "Revoked" : active ? "Active" : "Expired"}
                    </span>
                    {active ? (
                      <button
                        className="button button-secondary button-small"
                        disabled={busy !== null}
                        onClick={() => void revokeLink(link.shareLinkId)}
                        type="button"
                      >
                        {busy === link.shareLinkId ? "Revoking…" : "Revoke"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <h3>No active sharing</h3>
            <p>Create a time-limited link when an employer or reviewer needs selected passport information.</p>
          </div>
        )}
      </section>
    </>
  );
}
