# M1.02 — Design System and Global UX

## Purpose

M1.02 establishes the shared visual, interaction, responsive and accessibility contract used by every HSE Verify portal. It is not a cosmetic repaint. Later Worker, Company, Reviewer, Assessor, Administrator and Root Administrator features must build on the same tested primitives rather than creating isolated page-specific controls.

## Canonical scope

This brick covers:

- semantic design tokens;
- typography, spacing, radius, shadow and layout rules;
- buttons and form controls;
- cards, alerts, badges, empty states and loading states;
- tables and confirmation dialogs;
- desktop/mobile portal continuity;
- keyboard and focus behavior;
- validation, disabled and pending states;
- zoom, contrast, forced-colour and reduced-motion behavior;
- permanent automated architecture checks;
- owner hard testing.

It does not complete production authentication, role authorization, tenant isolation, notifications, evidence uploads or Identity review. Those remain in later canonical bricks.

## Token contract

`src/app/design-system.css` defines semantic tokens for:

- canvas, surface, text, muted text and borders;
- primary, success, warning and danger states;
- spacing increments;
- small, medium and large radii;
- shadows;
- standard control and touch-target heights;
- focus colour and ring;
- motion durations;
- header, menu and dialog layers.

Components should consume semantic `--ds-*` tokens. New modules must not invent arbitrary colours, focus styles, touch targets or z-index values when an existing token covers the need.

## Shared component inventory

### Buttons

`src/components/ui/button.tsx`

- primary;
- secondary;
- danger;
- ghost;
- default and small sizes;
- full-width mode;
- disabled and focus-visible states.

### Form controls

`src/components/ui/field.tsx`

- labelled field wrapper;
- optional marker;
- hint and error text;
- text/date/number/password/email inputs;
- select;
- textarea;
- checkbox field.

Every interactive form control must retain a visible boundary, visible keyboard focus and an honest disabled/error state.

### Feedback

`src/components/ui/feedback.tsx`

- neutral, success, warning and danger alerts;
- empty state;
- accessible loading skeleton with `aria-busy` and hidden status text.

### Status and surfaces

- `src/components/ui/status-badge.tsx`
- `src/components/ui/surface.tsx`

These provide reusable status tones, cards and page-heading structure.

### Data tables

`src/components/ui/data-table.tsx`

- semantic table, caption, head, body, rows, column headers and cells;
- keyboard-focusable horizontal region for narrow screens;
- no loss of column meaning at mobile widths.

### Confirmation dialogs

`src/components/ui/confirm-dialog.tsx`

- native modal `<dialog>`;
- labelled title and description;
- explicit cancel and confirm actions;
- optional danger confirmation;
- keyboard-operable trigger and controls;
- background interaction blocked while modal.

## Live adoption

M1.02 uses the shared system in real product paths:

- Worker login uses shared fields, inputs, alerts and buttons;
- Worker status badges delegate to the shared badge;
- Worker Profile history uses the shared table and empty state;
- Worker sign-out uses the shared confirmation dialog;
- mobile Worker navigation replaces the desktop sidebar below the portal breakpoint;
- root layout loads one global design-system layer and one explicit legacy-integration layer;
- the duplicate legacy Worker Profile stylesheet is removed.

## Responsive contract

- Desktop sidebar remains available above the portal breakpoint.
- Below 860px, a visible **Menu** control exposes the same Worker navigation links.
- Main content must remain usable at 320 CSS pixels wide.
- Tables may scroll horizontally inside a labelled region; the page itself must not require uncontrolled horizontal scrolling.
- Dialog actions stack on narrow screens.
- Forms and cards must remain readable at 200% browser zoom.

## Accessibility contract

Required behavior:

- skip link reaches `#main-content`;
- every form input has a visible label;
- active navigation uses `aria-current`;
- menus and account controls have accessible names;
- focus is visible without relying only on colour;
- touch targets are at least 44 CSS pixels for primary interactive controls;
- table headers use `scope="col"`;
- dialogs use `aria-labelledby` and `aria-describedby`;
- loading state exposes status text;
- reduced-motion mode removes non-essential transitions/animation;
- higher-contrast and forced-colour modes retain control boundaries.

## Automated gate

`npm run check:design-system` verifies:

- required semantic tokens;
- required reusable component files and contracts;
- root stylesheet ownership;
- removal of duplicate portal Profile CSS loading;
- shared component adoption in live routes;
- mobile navigation;
- confirmation dialog;
- accessible table and empty state;
- focus, contrast, forced-colour, reduced-motion and responsive CSS contracts.

It runs inside the permanent `npm run check` chain before the existing Profile, dependency, database, TypeScript, ESLint, protected runtime and production build gates.

## Security and workflow notes

- Design-system code does not bypass server authorization or data ownership.
- The sign-out dialog calls the existing server action; it does not create a client-only logout illusion.
- No role-switch control is introduced.
- Mobile navigation exposes only the same Worker links already authorized by the Worker Portal.
- The table displays existing permitted Profile audit projection data only.
- No user data is copied into a UI-only store.

## Definition of Done for M1.02

M1.02 receives DONE only when:

1. shared tokens and components exist;
2. live product paths use them;
3. mobile navigation restores route access below the desktop breakpoint;
4. keyboard, zoom, contrast, reduced motion and dialog behavior are testable;
5. duplicate legacy CSS ownership is removed;
6. `npm run check` and preview smoke pass;
7. the owner completes `docs/testing/M1_02_DESIGN_SYSTEM_HARD_TEST.md` with Overall PASS;
8. defects are fixed and retested;
9. Milestone Path, Later and validation records are updated.
