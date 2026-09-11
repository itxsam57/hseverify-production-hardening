import Link from "next/link";

import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import {
  ProfileCorrectionForm,
  ProfileSectionForm,
  ProfileSubmitForm
} from "@/components/worker/profile-forms";
import { StatusBadge } from "@/components/worker/status-badge";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { formatDateTime } from "@/lib/format";
import {
  PROFILE_SECTIONS,
  type ProfileSection
} from "@/lib/worker/profile-domain";
import { getWorkerProfileView } from "@/lib/worker/profile-service";

export const metadata = {
  title: "My Profile"
};

const SECTION_CONTENT: Record<
  ProfileSection,
  { label: string; description: string; step: number }
> = {
  personal: {
    label: "Personal details",
    description: "Legal identity context, residence and language.",
    step: 1
  },
  contact: {
    label: "Contact and address",
    description: "Current phone number and residential contact details.",
    step: 2
  },
  professional: {
    label: "Professional overview",
    description: "Occupation, experience and current work status.",
    step: 3
  }
};

function validSection(value: string | undefined): value is ProfileSection {
  return Boolean(value && PROFILE_SECTIONS.includes(value as ProfileSection));
}

function profileStatusLabel(status: "draft" | "ready" | "submitted"): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "ready":
      return "Ready to submit";
    case "submitted":
      return "Submitted";
  }
}

export default async function WorkerProfilePage({
  searchParams
}: {
  searchParams: Promise<{ section?: string }>;
}): Promise<React.JSX.Element> {
  const session = await requireWorkerSession();
  const view = await getWorkerProfileView(session);
  const params = await searchParams;
  const requestedSection = params.section;
  const activeSection = validSection(requestedSection)
    ? requestedSection
    : view.firstIncompleteSection ?? "personal";
  const recentAudit = [...view.record.audit].reverse().slice(0, 5);

  return (
    <div className="profile-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Worker Profile</p>
          <h1>My profile</h1>
          <p className="page-intro">
            Build the personal and professional record used to continue onboarding and approved assurance workflows.
          </p>
        </div>
        <StatusBadge
          label={profileStatusLabel(view.record.status)}
          tone={
            view.record.status === "submitted"
              ? "positive"
              : view.record.status === "ready"
                ? "warning"
                : "neutral"
          }
        />
      </header>

      <section className="profile-summary-card" aria-labelledby="profile-progress-heading">
        <div className="profile-summary-main">
          <div>
            <p className="section-kicker">Profile completion</p>
            <h2 id="profile-progress-heading">{view.completion}% complete</h2>
            <p>
              {view.firstIncompleteSection
                ? `Continue with ${SECTION_CONTENT[view.firstIncompleteSection].label.toLowerCase()}.`
                : "All required profile fields are complete."}
            </p>
          </div>
          <div
            className="progress-track profile-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={view.completion}
            aria-label="Worker profile completion"
          >
            <span style={{ width: `${view.completion}%` }} />
          </div>
        </div>
        <dl className="profile-summary-facts">
          <div>
            <dt>Worker ID</dt>
            <dd>{view.record.workerId}</dd>
          </div>
          <div>
            <dt>Account email</dt>
            <dd>{session.email}</dd>
          </div>
          <div>
            <dt>Current version</dt>
            <dd>{view.record.version}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatDateTime(view.record.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <nav className="profile-step-navigation" aria-label="Profile sections">
        {PROFILE_SECTIONS.map((section) => {
          const content = SECTION_CONTENT[section];
          const active = activeSection === section;
          const complete = view.sections[section].complete;
          return (
            <Link
              href={`/worker/profile?section=${section}`}
              className={`profile-step${active ? " profile-step-active" : ""}`}
              aria-current={active ? "step" : undefined}
              key={section}
            >
              <span className="profile-step-number" aria-hidden="true">
                {complete ? "✓" : content.step}
              </span>
              <span>
                <strong>{content.label}</strong>
                <small>{complete ? "Complete" : "Required"}</small>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="profile-layout">
        <section className="profile-editor-card" aria-labelledby="profile-section-heading">
          <div className="profile-editor-heading">
            <div>
              <p className="section-kicker">Step {SECTION_CONTENT[activeSection].step} of 3</p>
              <h2 id="profile-section-heading">{SECTION_CONTENT[activeSection].label}</h2>
              <p>{SECTION_CONTENT[activeSection].description}</p>
            </div>
            <StatusBadge
              label={view.sections[activeSection].complete ? "Complete" : "Incomplete"}
              tone={view.sections[activeSection].complete ? "positive" : "warning"}
            />
          </div>
          <ProfileSectionForm section={activeSection} record={view.record} />
        </section>

        <aside className="profile-aside" aria-label="Profile submission and history">
          <ProfileSubmitForm record={view.record} completion={view.completion} />

          <section className="profile-history-card" aria-labelledby="profile-history-heading">
            <p className="section-kicker">Audit history</p>
            <h2 id="profile-history-heading">Recent profile activity</h2>
            {recentAudit.length === 0 ? (
              <EmptyState
                description="Committed profile changes will appear here."
                title="No profile activity yet"
              />
            ) : (
              <DataTable caption="Recent profile activity">
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeader>Activity</DataTableHeader>
                    <DataTableHeader>Section</DataTableHeader>
                    <DataTableHeader>Time</DataTableHeader>
                    <DataTableHeader>Changes</DataTableHeader>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {recentAudit.map((event) => (
                    <DataTableRow key={event.id}>
                      <DataTableCell>{event.action.replaceAll("_", " ")}</DataTableCell>
                      <DataTableCell>
                        {event.section ? SECTION_CONTENT[event.section].label : "Profile"}
                      </DataTableCell>
                      <DataTableCell>{formatDateTime(event.occurredAt)}</DataTableCell>
                      <DataTableCell>
                        {event.changedFields.length > 0
                          ? `${event.changedFields.length} field(s)`
                          : "No field change"}
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            )}
          </section>
        </aside>
      </div>

      <ProfileCorrectionForm record={view.record} />
    </div>
  );
}
