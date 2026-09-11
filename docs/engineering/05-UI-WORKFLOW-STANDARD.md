# 05 — UI and Workflow Standard

## Functional UI

Every visible control must have a defined purpose, state, result, and failure path.

A button is not complete because it changes a label or opens an empty panel. It must execute the intended workflow and reflect persisted server state where applicable.

## Required states

Relevant screens and actions must handle:

- initial loading;
- empty state;
- valid state;
- validation failure;
- authorization failure;
- network or provider failure;
- retry;
- success confirmation;
- duplicate submission prevention;
- stale data;
- refresh or restart;
- cancellation or safe exit where allowed.

## Navigation

- Route changes must render the correct view without requiring an accidental manual refresh.
- Back navigation must not cross into another role or protected area.
- Notifications should open the intended destination when the product requires deep links.
- Logout must return the user to the intended public or login state.
- Shared navigation changes require spot-checks across all roles using that component.

## Forms

- Preserve intended input during recoverable errors.
- Show field-specific validation.
- Prevent unintended duplicate submissions.
- Confirm save only after durable success.
- Reload saved values correctly.
- Avoid carrying a selected file or stale data into an unrelated form.

## Multi-step workflows

Record the allowed states and transitions in `PROJECT-PROFILE.md` or feature documentation.

For assessments, onboarding, review, approval, payment, publishing, or similar workflows, test interruption, resume, rejection, retry, duplicate action, and role handoff.

## Responsive and accessibility boundary

Automation may check basic accessibility and multiple viewport sizes. The owner remains responsible for final visual and usability acceptance.

## Change impact

Shared UI components can affect many features. The handoff must identify indirect areas such as:

- all dashboards using shared navigation;
- all forms using a shared uploader;
- all roles using common authentication middleware;
- all pages using a shared table, modal, or notification component.


---
