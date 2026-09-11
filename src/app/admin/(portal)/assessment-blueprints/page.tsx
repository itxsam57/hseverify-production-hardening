import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getAssessmentBlueprintService } from "@/lib/assessment-generation/assessment-blueprint-service";
import {
  createAssessmentBlueprintAction,
  reviseAssessmentBlueprintAction,
  setAssessmentBlueprintStatusAction
} from "./actions";

const EXAMPLE_SELECTORS = JSON.stringify(
  [
    {
      count: 5,
      questionType: "MULTIPLE_CHOICE",
      domainReference: "Hazard Control",
      difficulty: "MEDIUM",
      tagsAll: ["core"]
    }
  ],
  null,
  2
);

type SearchParams = Promise<{ success?: string; error?: string }>;

export default async function AssessmentBlueprintsPage({
  searchParams
}: {
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const blueprints = await (await getAssessmentBlueprintService()).listBlueprints(principal);
  const params = await searchParams;

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Assessment administration</p>
          <h1>Assessment blueprints</h1>
          <p>
            Blueprints define the exact selector mix used when HSE Verify generates a Worker-specific assessment form. Every published revision is immutable, and generated forms pin exact Question Bank versions.
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

      <form action={createAssessmentBlueprintAction}>
        <h2>Create blueprint</h2>
        <label>
          Blueprint reference
          <input name="blueprintReference" required minLength={2} maxLength={120} />
        </label>
        <label>
          Blueprint title
          <input name="blueprintTitle" required minLength={2} maxLength={200} />
        </label>
        <label>
          Framework reference
          <input name="frameworkReference" required minLength={2} maxLength={120} />
        </label>
        <label>
          Selector JSON
          <textarea
            name="selectorsJson"
            required
            rows={12}
            defaultValue={EXAMPLE_SELECTORS}
          />
        </label>
        <p className="muted-copy">
          Each selector requires a count. Optional filters are questionType, domainReference, difficulty and tagsAll. The complete blueprint may request at most 500 questions.
        </p>
        <button type="submit">Create blueprint</button>
      </form>

      <section>
        <h2>Current blueprints</h2>
        {blueprints.length === 0 ? (
          <p>No assessment blueprints have been created.</p>
        ) : (
          blueprints.map((item) => (
            <article key={item.blueprint.blueprintId}>
              <h3>{item.blueprint.blueprintReference}</h3>
              <p>
                Version {item.version.versionNo} · {item.blueprint.blueprintStatus} · {item.version.totalCount} questions
              </p>
              <p>{item.version.title}</p>
              <p>
                Framework: <code>{item.version.frameworkId}</code>
              </p>
              <p>
                Current version: <code>{item.blueprint.currentVersionId}</code>
              </p>
              <pre>{JSON.stringify(item.version.selectors, null, 2)}</pre>

              <form action={setAssessmentBlueprintStatusAction}>
                <input type="hidden" name="blueprintId" value={item.blueprint.blueprintId} />
                <input
                  type="hidden"
                  name="blueprintStatus"
                  value={item.blueprint.blueprintStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE"}
                />
                <button type="submit">
                  {item.blueprint.blueprintStatus === "ACTIVE" ? "Deactivate" : "Reactivate"}
                </button>
              </form>

              <details>
                <summary>Create a new immutable revision</summary>
                <form action={reviseAssessmentBlueprintAction}>
                  <input type="hidden" name="blueprintId" value={item.blueprint.blueprintId} />
                  <input
                    type="hidden"
                    name="expectedCurrentVersionId"
                    value={item.blueprint.currentVersionId}
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
                    Revision framework reference
                    <input
                      name="revisionFrameworkReference"
                      required
                      minLength={2}
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Revision selector JSON
                    <textarea
                      name="revisionSelectorsJson"
                      required
                      rows={10}
                      defaultValue={JSON.stringify(item.version.selectors, null, 2)}
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
