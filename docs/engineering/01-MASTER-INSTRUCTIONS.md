# 01 — Master Instructions

These documents define the permanent engineering operating standard for this repository.

## Reading order

Before changing code, the AI developer must read:

1. `PROJECT-PROFILE.md`
2. `PROJECT-TEST-MATRIX.md`
3. `REGRESSION-REGISTER.md`
4. the universal standard relevant to the task;
5. the current feature request and affected code.

Do not repeatedly read every long document when the task is narrow. Read the master rules once, then open only the relevant sections and project-specific files.

## Priority order

When instructions conflict, use this order:

1. explicit current instruction from the project owner;
2. legal, safety, privacy, security, and data-protection requirements;
3. `PROJECT-PROFILE.md`;
4. universal engineering standards;
5. existing repository conventions;
6. implementation preference.

A project-specific rule may specialize a universal rule, but it must not silently weaken security, privacy, data isolation, test integrity, or truthful reporting.

## Core operating rule

No feature is complete merely because the page looks correct or one happy-path interaction works.

A feature is complete only when:

- the requested behaviour is implemented;
- existing behaviour is preserved;
- applicable automated checks pass;
- authorization and data ownership are enforced server-side;
- state persists correctly;
- known regressions remain protected;
- a preview or runnable build is available when applicable;
- the owner receives an exact manual test handoff.

## Owner/developer boundary

The project owner normally performs:

- visual inspection;
- responsive-layout inspection;
- natural user-flow judgement;
- wording and usability judgement;
- real camera, microphone, file-picker, device, or OS behaviour;
- human acceptance of the requested feature.

The AI developer and automation perform:

- installation and build checks;
- lint and type checks;
- repeatable unit, integration, API, permission, and workflow tests;
- regression tests;
- change-impact analysis;
- concise failure reporting;
- preparation of exact manual test steps.

## Truthfulness

Never report a check as passed when it was skipped, not configured, blocked, or only assumed. Use explicit states:

- PASS
- FAIL
- BLOCKED
- NOT APPLICABLE
- NOT CONFIGURED

A required blocked check prevents `READY FOR MANUAL BROWSER TESTING` unless the project profile explicitly defines a safe exception.


---
