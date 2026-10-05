import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getAssessmentBlueprintService } from "@/lib/assessment-generation/assessment-blueprint-service";
import { getAssessmentDeliverySettingsService } from "@/lib/assessment-generation/assessment-delivery-settings-service";
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

function DeliverySettingsFields({
  prefix = "",
  defaults
}: {
  prefix?: string;
  defaults?: {
    timing: import("@/lib/assessment-generation/assessment-delivery-settings").AssessmentTimingSettings | null;
    progressionMode: "STRICT" | "CONTROLLED_REVIEW" | "SECTION_REVIEW";
    sections: readonly { title: string; endPosition: number }[];
    requireCamera: boolean;
    requireMicrophone: boolean;
    requireScreenShare: boolean;
    recordCamera: boolean;
    recordMicrophone: boolean;
    recordScreen: boolean;
    recordingRetentionDays: number;
    integrityFailureMode: "REVIEW" | "BLOCK";
    requireFullscreen: boolean;
    requireEnvironmentDeclaration: boolean;
    requireMonitoringConsent: boolean;
  };
}): React.JSX.Element {
  const name = (field: string) => `${prefix}${field}`;
  return (
    <fieldset className="content-stack">
      <legend>Candidate delivery settings</legend>
      <label>Timer mode<select name={name("timerMode")} defaultValue={defaults?.timing?.mode ?? "UNTIMED"}>
        <option value="UNTIMED">Untimed</option>
        <option value="COMBINED">Combined timer</option>
        <option value="SEPARATE">Separate section timers</option>
      </select></label>
      <label>Combined duration in seconds<input type="number" min={1} max={86400} name={name("durationSeconds")} defaultValue={defaults?.timing?.mode === "COMBINED" ? defaults.timing.durationSeconds : ""} /></label>
      <p className="muted-copy">Separate timers require Section Review and durationSeconds for each section. Review and interruptions use the same clock; reconnecting does not add time.</p>
      <label>
        Progression mode
        <select name={name("progressionMode")} defaultValue={defaults?.progressionMode ?? "STRICT"}>
          <option value="STRICT">Strict Progression — no return to committed questions</option>
          <option value="CONTROLLED_REVIEW">Controlled Review — revisit one committed question at a time</option>
          <option value="SECTION_REVIEW">Section Review — revisit inside an unlocked section</option>
        </select>
      </label>
      <label>
        Section JSON
        <textarea
          name={name("sectionsJson")}
          rows={4}
          defaultValue={defaults?.sections.length ? JSON.stringify(defaults.sections, null, 2) : ""}
          placeholder={'[{"title":"Section 1","endPosition":5},{"title":"Section 2","endPosition":10}]'}
        />
      </label>
      <p className="muted-copy">Section JSON is required only for Section Review and the final boundary must equal the blueprint question count.</p>
      <label><input type="checkbox" name={name("requireCamera")} value="yes" defaultChecked={defaults?.requireCamera ?? false} /> Require camera check</label>
      <label><input type="checkbox" name={name("requireMicrophone")} value="yes" defaultChecked={defaults?.requireMicrophone ?? false} /> Require microphone check</label>
      <label><input type="checkbox" name={name("requireScreenShare")} value="yes" defaultChecked={defaults?.requireScreenShare ?? false} /> Require screen-share check</label>
      <label><input type="checkbox" name={name("recordCamera")} value="yes" defaultChecked={defaults?.recordCamera ?? false} /> Record camera during the assessment</label>
      <label><input type="checkbox" name={name("recordMicrophone")} value="yes" defaultChecked={defaults?.recordMicrophone ?? false} /> Record microphone during the assessment</label>
      <label><input type="checkbox" name={name("recordScreen")} value="yes" defaultChecked={defaults?.recordScreen ?? false} /> Record shared screen during the assessment</label>
      <label>Recording retention days<input type="number" min={1} max={3650} name={name("recordingRetentionDays")} defaultValue={defaults?.recordingRetentionDays ?? 30} /></label>
      <label>Monitoring failure response<select name={name("integrityFailureMode")} defaultValue={defaults?.integrityFailureMode ?? "REVIEW"}><option value="REVIEW">Continue but force human review</option><option value="BLOCK">Block until required monitoring recovers</option></select></label>
      <label><input type="checkbox" name={name("requireFullscreen")} value="yes" defaultChecked={defaults?.requireFullscreen ?? true} /> Require fullscreen capability</label>
      <label><input type="checkbox" name={name("requireEnvironmentDeclaration")} value="yes" defaultChecked={defaults?.requireEnvironmentDeclaration ?? true} /> Require environment declaration</label>
      <label><input type="checkbox" name={name("requireMonitoringConsent")} value="yes" defaultChecked={defaults?.requireMonitoringConsent ?? true} /> Require monitoring consent</label>
    </fieldset>
  );
}

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
  const deliveryService = getAssessmentDeliverySettingsService();
  const deliverySettings = new Map(
    await Promise.all(
      blueprints.map(async (item) => [
        item.version.blueprintVersionId,
        await deliveryService.get(item.version.blueprintVersionId)
      ] as const)
    )
  );
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
        <DeliverySettingsFields />
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
              {(() => {
                const delivery = deliverySettings.get(item.version.blueprintVersionId);
                return delivery ? (
                  <dl>
                    <div><dt>Timer</dt><dd>{delivery.timing?.mode === "COMBINED" ? "Combined · " + delivery.timing.durationSeconds + " seconds" : delivery.timing?.mode === "SEPARATE" ? "Separate section timers" : "Untimed"}</dd></div>
                    <div><dt>Progression</dt><dd>{delivery.progressionMode.replaceAll("_", " ")}</dd></div>
                    <div><dt>Camera</dt><dd>{delivery.requireCamera ? "Required" : "Not required"}</dd></div>
                    <div><dt>Microphone</dt><dd>{delivery.requireMicrophone ? "Required" : "Not required"}</dd></div>
                    <div><dt>Screen share</dt><dd>{delivery.requireScreenShare ? "Required" : "Not required"}</dd></div>
                    <div><dt>Camera recording</dt><dd>{delivery.recordCamera ? "Recorded" : "Not recorded"}</dd></div>
                    <div><dt>Microphone recording</dt><dd>{delivery.recordMicrophone ? "Recorded" : "Not recorded"}</dd></div>
                    <div><dt>Screen recording</dt><dd>{delivery.recordScreen ? "Recorded" : "Not recorded"}</dd></div>
                    <div><dt>Recording retention</dt><dd>{delivery.recordingRetentionDays} days</dd></div>
                    <div><dt>Monitoring failure</dt><dd>{delivery.integrityFailureMode === "BLOCK" ? "Block until recovered" : "Continue with human review"}</dd></div>
                  </dl>
                ) : null;
              })()}

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
                  <DeliverySettingsFields
                    prefix="revision"
                    defaults={deliverySettings.get(item.version.blueprintVersionId)}
                  />
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