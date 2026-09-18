"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ShareLink = {
  shareLinkId: string;
  purpose: string;
  fields: readonly string[];
  expiresAt?: string | null;
  revokedAt?: string | null;
};

const availableFields = [
  ["worker_id", "Worker ID"],
  ["qualifications", "Qualifications"],
  ["competency", "Competency status"],
  ["identity", "Identity status"]
] as const;

export function ShareLinkManager({ links }: { links: readonly ShareLink[] }) {
  const router = useRouter();
  const [purpose, setPurpose] = useState("Credential review");
  const [employerDetail, setEmployerDetail] = useState("");
  const [fields, setFields] = useState<string[]>(["worker_id", "qualifications"]);
  const [expiryDays, setExpiryDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function createLink(event: React.FormEvent) {
    event.preventDefault();
    if (!fields.length) return setNotice("Select at least one passport field.");
    setBusy(true);
    setNotice("");
    const createdAt = new Date();
    const expiresAt = expiryDays === "none" ? null : new Date(createdAt.getTime() + Number(expiryDays) * 86400000).toISOString();
    const response = await fetch("/api/share-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose, employerDetail: employerDetail || undefined, fields, createdAt: createdAt.toISOString(), expiresAt })
    });
    setBusy(false);
    if (!response.ok) return setNotice("We could not create the link. Please try again.");
    setNotice("Scoped share link created.");
    router.refresh();
  }

  async function revoke(shareLinkId: string) {
    setBusy(true);
    setNotice("");
    const response = await fetch("/api/share-links", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shareLinkId, revokedAt: new Date().toISOString() })
    });
    setBusy(false);
    setNotice(response.ok ? "Share link revoked." : "We could not revoke the link.");
    if (response.ok) router.refresh();
  }

  return (
    <>
      <form className="dashboard-section" onSubmit={(event) => void createLink(event)}>
        <h2>Create a share link</h2>
        <div className="field-group"><label htmlFor="share-purpose">Purpose</label><input id="share-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} required /></div>
        <div className="field-group"><label htmlFor="share-recipient">Recipient or employer (optional)</label><input id="share-recipient" value={employerDetail} onChange={(event) => setEmployerDetail(event.target.value)} /></div>
        <fieldset><legend>Information to share</legend>{availableFields.map(([value, label]) => <label key={value}><input type="checkbox" checked={fields.includes(value)} onChange={() => setFields((current) => current.includes(value) ? current.filter((field) => field !== value) : [...current, value])} /> {label}</label>)}</fieldset>
        <div className="field-group"><label htmlFor="share-expiry">Link expires</label><select id="share-expiry" value={expiryDays} onChange={(event) => setExpiryDays(event.target.value)}><option value="7">In 7 days</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="none">No expiry</option></select></div>
        <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create scoped link"}</button>
        {notice ? <p role="status">{notice}</p> : null}
      </form>
      <section className="dashboard-section" aria-labelledby="active-share-links">
        <h2 id="active-share-links">Your links</h2>
        {links.length ? <div className="table-scroll-region" role="region" aria-label="Scoped share links"><table><thead><tr><th>Purpose</th><th>Fields</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {links.map((link) => { const expired = Boolean(link.expiresAt && new Date(link.expiresAt) <= new Date()); const status = link.revokedAt ? "Revoked" : expired ? "Expired" : "Active"; return <tr key={link.shareLinkId}><td>{link.purpose}</td><td>{link.fields.join(", ")}</td><td>{link.expiresAt ? new Date(link.expiresAt).toLocaleDateString() : "No expiry"}</td><td><span className="status-pill">{status}</span></td><td>{status === "Active" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void revoke(link.shareLinkId)}>Revoke</button> : "—"}</td></tr>; })}
        </tbody></table></div> : <div className="empty-state"><p>No scoped share links have been created.</p></div>}
      </section>
    </>
  );
}
