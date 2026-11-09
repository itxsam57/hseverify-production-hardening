import Image from "next/image";
import Link from "next/link";

import type { InterviewConsolePanel } from "./interview-console-tabs";
import type { InterviewConsoleContext } from "@/lib/interview/interview-console-context-service";

export function createInterviewContextPanels(context: InterviewConsoleContext, requestId: string): readonly InterviewConsolePanel[] {
  const preview = (fileId: string) => "/assessor/interviews/"+encodeURIComponent(requestId)+"/evidence/"+encodeURIComponent(fileId);
  const value = (item: string | null) => item ?? "Not recorded";
  return [
    { id:"profile",label:"Profile",content:<section className="dashboard-section">
      <h2>Worker profile</h2>
      {context.profile.photoFileId ? <Link href={preview(context.profile.photoFileId)} target="_blank"><Image src={preview(context.profile.photoFileId)} alt={"Profile photo of "+context.profile.name} width={160} height={160} unoptimized /></Link> : <p>No verified profile photo is available.</p>}
      <dl className="compact-definition-list">
        <div><dt>Name</dt><dd>{context.profile.name}</dd></div>
        <div><dt>Worker ID</dt><dd>{value(context.profile.workerId)}</dd></div>
        <div><dt>Occupation</dt><dd>{value(context.profile.occupation)}</dd></div>
        <div><dt>Experience</dt><dd>{context.profile.experience === null ? "Not recorded" : context.profile.experience+" years"}</dd></div>
        <div><dt>Country of residence</dt><dd>{value(context.profile.country)}</dd></div>
        <div><dt>Primary language</dt><dd>{value(context.profile.language)}</dd></div>
      </dl>
    </section> },
    { id:"evidence",label:"Evidence and employment",content:<section className="dashboard-section">
      <h2>Verified qualifications and evidence</h2>
      <p>Current versions approved for this case. Employment and observations are evidence of experience, not a competency decision.</p>
      {context.evidence.length === 0 ? <p>No current approved evidence is recorded for this case.</p> : <ul className="content-stack">{context.evidence.map(item=><li key={item.taskId}>
        <h3>{item.title ?? item.label}</h3><p>{item.kind} · Approved</p>
        {item.issuer ? <p>Issuer: {item.issuer}{item.level ? " · Level: "+item.level : ""}</p> : null}
        {item.company ? <p>{item.company}{item.role ? " · "+item.role : ""}</p> : null}
        {item.duties ? <p style={{whiteSpace:"pre-wrap"}}>{item.duties}</p> : null}
        {item.startDate ? <p>{item.startDate} – {item.endDate ?? "Current"}</p> : null}
        {item.fileId ? <Link href={preview(item.fileId)} target="_blank">Preview approved evidence</Link> : <p>No available file attachment.</p>}
      </li>)}</ul>}
      <h2>Supervisor observations</h2>
      {context.observations.length === 0 ? <p>No approved supervisor observations are recorded for this case.</p> : <ul>{context.observations.map(item=><li key={item.id}>
        <h3>{item.competency}</h3><p>{item.observer} · {item.observedAt} · {item.outcome.replaceAll("_"," ")}</p><p style={{whiteSpace:"pre-wrap"}}>{item.text}</p>
      </li>)}</ul>}
    </section> },
    { id:"assessment",label:"Assessment",content:<section className="dashboard-section">
      <h2>Assessment topic breakdown</h2>
      {context.topics.length === 0 ? <p>No submitted assessment responses are available for this case.</p> : <ul>{context.topics.map(topic=><li key={topic.attemptId+"/"+topic.topic}>
        <strong>{topic.topic}</strong>: {topic.total} questions · {topic.correct} correct objective responses · {topic.incorrectMcq} incorrect or unanswered MCQ/true-false responses
        <p className="muted-copy">Attempt {topic.attemptId}</p>
      </li>)}</ul>}
      <h2>Written answers</h2>
      {context.written.length === 0 ? <p>No submitted written answers are available.</p> : <ol>{context.written.map(answer=><li key={answer.attemptId+"/"+answer.position}>
        <h3>{answer.topic} · Question {answer.position}</h3><p>{answer.prompt}</p><p style={{whiteSpace:"pre-wrap"}}>{answer.response ?? "No response submitted."}</p>
        <p className="muted-copy">Attempt {answer.attemptId}</p>
      </li>)}</ol>}
    </section> },
    { id:"integrity",label:"Integrity",content:<section className="dashboard-section">
      <h2>Integrity observations</h2><p>These observations are leads for human review. They do not establish misconduct.</p>
      {context.integrity.length === 0 ? <p>No integrity observations are recorded for this case.</p> : <ul>{context.integrity.map((event,index)=><li key={event.attemptId+"/"+index}>
        <strong>{event.classification}</strong> · {event.eventType.replaceAll("_"," ")} · {event.state} · {event.occurredAt}<p className="muted-copy">Attempt {event.attemptId}</p>
      </li>)}</ul>}
    </section> },
    { id:"history",label:"History",content:<section className="dashboard-section">
      <h2>Assessment attempts</h2>
      {context.attempts.length === 0 ? <p>No assessment attempts are recorded for this case.</p> : <ul>{context.attempts.map(attempt=><li key={attempt.attemptId}>
        {attempt.attemptId} · {attempt.status.replaceAll("_"," ")} · Started {attempt.startedAt}{attempt.submittedAt ? " · Submitted "+attempt.submittedAt : ""}
      </li>)}</ul>}
      <h2>Interview history</h2><ul>{context.history.map(item=><li key={item.requestId}>
        {item.requestId === requestId ? "Current interview" : "Previous interview"} · {item.status.replaceAll("_"," ")} · {item.runtimeStatus?.replaceAll("_"," ") ?? "Not opened"}
        <p>{item.scheduledAt ?? "Not scheduled"} · Recommendation: {item.recommendation?.replaceAll("_"," ") ?? "Pending"}</p>
      </li>)}</ul>
    </section> },
    { id:"comments",label:"Reviewer comments",content:<section className="dashboard-section">
      <h2>Reviewer comments shared with the Assessor</h2><p>Only reasons explicitly shared by the reviewer appear here.</p>
      {context.comments.length === 0 ? <p>No reviewer comments have been shared for this case.</p> : <ul>{context.comments.map((comment,index)=><li key={comment.kind+"/"+index}>
        <h3>{comment.kind.replaceAll("_"," ")} · {comment.outcome.replaceAll("_"," ")}</h3><p style={{whiteSpace:"pre-wrap"}}>{comment.reason}</p><p>{comment.reviewedAt}</p>
      </li>)}</ul>}
    </section> },
    { id:"decision",label:"Decision context",content:<section className="dashboard-section">
      <h2>Decision context</h2><dl className="compact-definition-list">
        <div><dt>Case status</dt><dd>{context.caseStatus}</dd></div>
        <div><dt>Next action</dt><dd>{value(context.nextAction)}</dd></div>
        <div><dt>Effective policy</dt><dd>{value(context.policyReference)}</dd></div>
        <div><dt>Assessment frameworks</dt><dd>{context.frameworkReferences.length ? context.frameworkReferences.join(", ") : "No assessment framework is pinned."}</dd></div>
      </dl>
      {context.decision ? <p>Latest decision: {context.decision.state} · Reason: {context.decision.reasonCode} · Rule version: {context.decision.ruleVersion} · {context.decision.createdAt}</p> : <p>No Decision Engine outcome is recorded yet.</p>}
    </section> }
  ];
}
