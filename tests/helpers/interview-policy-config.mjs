export const configuredPolicy = () => ({
  context: { tradeScope: "electrical", qualificationScope: "level-3", riskLevel: "HIGH", language: "English", jurisdiction: "GB" },
  minimumActiveSeconds: 60,
  minimumTopics: ["controls", "safety"],
  randomQuestionCount: 1,
  scoringGuidance: "Use demonstrated competence and the seven published score dimensions.",
  safetyCriteria: [{ criterionId: "live-work", statement: "Proposes live work without approved isolation." }],
  recording: { policy: "NOTES_ONLY", retentionDays: 45, consentRequired: false },
  questions: [
    { templateId: "controls", kind: "MANDATORY", topic: "controls", prompt: "Explain how you isolate the supply and verify the controls.", scoringGuidance: "Check isolation, verification and escalation." },
    { templateId: "safety", kind: "HIGH_RISK", topic: "safety", prompt: "Explain the stop-work criteria for this high-risk electrical task.", selectors: { riskLevels: ["HIGH", "CRITICAL"] } },
    { templateId: "random-a", kind: "RANDOM", topic: "faults", prompt: "Describe how you diagnose a fault without exposing another worker." },
    { templateId: "random-b", kind: "RANDOM", topic: "handover", prompt: "Explain how you document safe handover after the repair." },
    { templateId: "foreign", kind: "MANDATORY", topic: "foreign", prompt: "Explain the controls that apply only in a different jurisdiction.", selectors: { jurisdictions: ["US"] } },
    { templateId: "follow", kind: "FOLLOW_UP", topic: "safety", prompt: "Clarify which isolation checks you repeat before restarting the task." }
  ]
});
