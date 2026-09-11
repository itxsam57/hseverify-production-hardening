import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getAssessmentCatalogueService } from "@/lib/assessment-catalogue/assessment-catalogue-service";
import {
  createAssessmentCatalogueEntryAction,
  reviseAssessmentCatalogueEntryAction,
  setAssessmentCatalogueStatusAction
} from "./actions";

type SearchParams = Promise<{ success?: string; error?: string }>;

async function listAdmin(principal: AuthorizationPrincipal) {
  return (await getAssessmentCatalogueService()).listEntries(principal);
}

export default async function AssessmentCataloguePage({
  searchParams
}: {
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const catalogue = await listAdmin(principal);
  const params = await searchParams;

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Assessment administration</p>
          <h1>Assessment catalogue</h1>
          <p>
            Publish the assessment offerings Workers may become eligible to see. Each immutable
            catalogue version pins one exact approved blueprint version and framework; this surface
            controls availability only and does not create or start assessment attempts.
          </p>
        </div>
      </div>

      {params.success ? (
        <div className="form-alert form-alert-success" role="status">
          {params.success}
        </div>
      ) : null}
      {params.error ? (
        <div className="form-alert" role="alert">
          {params.error}
        </div>
      ) : null}

      <form action={createAssessmentCatalogueEntryAction}>
        <h2>Create catalogue entry</h2>
        <label>
          Catalogue reference
          <input name="catalogueReference" required minLength={2} maxLength={120} />
        </label>
        <label>
          Catalogue title
          <input name="catalogueTitle" required minLength={2} maxLength={200} />
        </label>
        <label>
          Description
          <textarea name="description" rows={4} maxLength={2000} />
        </label>
        <label>
          Framework reference
          <input name="frameworkReference" required minLength={2} maxLength={120} />
        </label>
        <label>
          Blueprint version ID
          <input
            name="blueprintVersionId"
            required
            pattern="blueprint_version_[A-Za-z0-9_-]{24}"
          />
        </label>
        <label>
          Minimum verified qualifications
          <input
            name="minimumVerifiedQualifications"
            type="number"
            required
            min={0}
            max={50}
            step={1}
            defaultValue={1}
          />
        </label>
        <p className="muted-copy">
          The framework and exact blueprint version must already be active. Qualification counts
          are re-evaluated from approved current Worker evidence when availability is read.
        </p>
        <button type="submit">Create catalogue entry</button>
      </form>

      <section>
        <h2>Current catalogue</h2>
        {catalogue.length === 0 ? (
          <p>No assessment catalogue entries have been created.</p>
        ) : (
          catalogue.map((item) => (
            <article key={item.entry.catalogueEntryId}>
              <h3>{item.entry.catalogueReference}</h3>
              <p>
                Version {item.version.versionNo} · {item.entry.catalogueStatus}
              </p>
              <p>{item.version.title}</p>
              {item.version.description ? <p>{item.version.description}</p> : null}
              <p>
                Framework: <code>{item.version.frameworkId}</code>
              </p>
              <p>
                Blueprint version: <code>{item.version.blueprintVersionId}</code>
              </p>
              <p>
                Minimum verified qualifications: {item.version.minimumVerifiedQualifications}
              </p>
              <p>
                Current catalogue version: <code>{item.entry.currentVersionId}</code>
              </p>

              <form action={setAssessmentCatalogueStatusAction}>
                <input
                  type="hidden"
                  name="catalogueEntryId"
                  value={item.entry.catalogueEntryId}
                />
                <input
                  type="hidden"
                  name="catalogueStatus"
                  value={item.entry.catalogueStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE"}
                />
                <button type="submit">
                  {item.entry.catalogueStatus === "ACTIVE" ? "Deactivate" : "Reactivate"}
                </button>
              </form>

              <details>
                <summary>Create a new immutable catalogue revision</summary>
                <form action={reviseAssessmentCatalogueEntryAction}>
                  <input
                    type="hidden"
                    name="catalogueEntryId"
                    value={item.entry.catalogueEntryId}
                  />
                  <input
                    type="hidden"
                    name="expectedCurrentVersionId"
                    value={item.entry.currentVersionId}
                  />
                  <label>
                    Revision title
                    <input
                      name="revisionTitle"
                      required
                      minLength={2}
                      maxLength={200}
                      defaultValue={item.version.title}
                    />
                  </label>
                  <label>
                    Revision description
                    <textarea
                      name="revisionDescription"
                      rows={4}
                      maxLength={2000}
                      defaultValue={item.version.description ?? ""}
                    />
                  </label>
                  <label>
                    Revision framework reference
                    <input
                      name="revisionFrameworkReference"
                      required
                      minLength={2}
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Revision blueprint version ID
                    <input
                      name="revisionBlueprintVersionId"
                      required
                      pattern="blueprint_version_[A-Za-z0-9_-]{24}"
                      defaultValue={item.version.blueprintVersionId}
                    />
                  </label>
                  <label>
                    Revision minimum verified qualifications
                    <input
                      name="revisionMinimumVerifiedQualifications"
                      type="number"
                      required
                      min={0}
                      max={50}
                      step={1}
                      defaultValue={item.version.minimumVerifiedQualifications}
                    />
                  </label>
                  <button type="submit">Publish revision</button>
                </form>
              </details>
            </article>
          ))
        )}
      </section>
    </section>
  );
}
