# Structured interview policy

Publish the optional `interview` object in **Admin → Frameworks → Policy values JSON**. The existing publisher validates it before publishing an immutable version. Normal case creation pins that version; later publication does not change a case or its frozen playbook.

The example below shows the shape. Its duration, recording retention and question content are illustrative values for an approving administrator to replace.

```json
{
  "pass_mark": 70,
  "interview": {
    "context": {
      "tradeScope": "electrical",
      "qualificationScope": "level-3",
      "riskLevel": "HIGH",
      "language": "English",
      "jurisdiction": "GB"
    },
    "minimumActiveSeconds": 120,
    "minimumTopics": ["isolation"],
    "randomQuestionCount": 1,
    "scoringGuidance": "Use the observed evidence to score each of the seven dimensions from zero to five.",
    "recording": {
      "policy": "NOTES_ONLY",
      "retentionDays": 30,
      "consentRequired": false
    },
    "safetyCriteria": [
      {
        "criterionId": "live-work",
        "statement": "Proposes live work without approved isolation."
      }
    ],
    "questions": [
      {
        "templateId": "isolation",
        "kind": "MANDATORY",
        "topic": "isolation",
        "prompt": "Explain the isolation and verification steps before starting this task.",
        "scoringGuidance": "Require a clear explanation of isolation, verification and authorization."
      },
      {
        "templateId": "changed-condition",
        "kind": "RANDOM",
        "topic": "isolation",
        "prompt": "Explain what you would do if the isolation condition changed during the task."
      },
      {
        "templateId": "verification-follow-up",
        "kind": "FOLLOW_UP",
        "topic": "isolation",
        "prompt": "Describe how you would confirm that the isolation remains effective."
      }
    ]
  }
}
```

Question kinds are `MANDATORY`, `RANDOM`, `WEAK_AREA`, `HIGH_RISK`, `INTEGRITY` and `FOLLOW_UP`. Optional question selectors are `tradeScopes`, `qualificationScopes`, `riskLevels`, `jurisdictions`, `weakTopics`, `requiresWrittenWeakness`, `requiresIntegrity` and `minimumAttempts`. Selection uses the pinned context and the case's existing assessment, written-scoring, integrity and attempt evidence. An eligible mandatory question and enough eligible random questions must exist. Random selection is stable for the same request and snapshot.

Configured request context is persisted in the original insert, before matching. The frozen question set records the selected template IDs, policy version, case snapshot, selection context and guidance in the existing JSON fields. Assessor follow-ups must come from eligible approved follow-up templates; they append a new set version.

Optional `recordingRules` contain the same recording fields as `recording`, plus context selectors for trade, qualification, risk and jurisdiction. Recording policies are `VIDEO_AUDIO`, `AUDIO_ONLY`, `NOTES_ONLY` and `PROHIBITED`. Rules resolve before readiness and consent. Notes-only and prohibited recording cannot require recording consent. Omitting recording configuration retains the existing recording rules.

In **Assessor → Interview → Notes and scoring**, mark the covered questions and record each approved safety finding. End requires all seven integer scores from zero to five, nonempty comments, current set references, mandatory question coverage, the configured minimum topics, and all configured safety findings. A confirmed finding requires evidence comments. Configured minimum active time excludes pauses and technical holds. Validation errors keep the runtime open and explain what remains incomplete.

Coverage, findings and set references freeze at End. Final submission remains bound to the current case interview and actual runtime session. A confirmed automatic-fail finding requires the Fail recommendation; it cannot be removed to submit Pass.

When the pinned policy has no `interview` object, the existing legacy playbook remains available and is identified as legacy. No minimum duration is invented. Historical policy snapshots, question sets and completed records are retained.
