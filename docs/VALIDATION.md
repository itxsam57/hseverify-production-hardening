# Validation Record

## Repository access and release discipline

- Confirmed live GitHub read and write access.
- Permanent validation and rollback workflows use read-only repository permission.
- No brick receives DONE from compilation or CI alone; owner acceptance remains mandatory.
- Every owner-discovered defect is release-blocking until repaired, regression-tested and owner-retested.

## Accepted Worker Dashboard and Profile slice

Pull request #3 passed Worker route and role-isolation validation, Profile persistence checks, five domain tests, strict TypeScript, ESLint and a production build. The owner reported the Worker Dashboard and Worker Profile hard test as **PASS on 2 August 2026**.

## M1.01 platform foundation — DONE

Pull request #5 introduced validated runtime environments, PostgreSQL-compatible persistence, migrations, preview artifacts and rollback-candidate tooling.

### LATER-OWNER-001

The first Windows owner test found that migrations opened the PGlite database but the Next.js/Turbopack application failed on a protected Dashboard path with a path/URL error wrapped as `ProfileStorageConfigurationError`. Pull request #6 normalized PGlite storage, aligned migration and application database opening, externalized PGlite from the server bundle, corrected error boundaries and added Windows-path plus existing-database regressions. The owner then loaded, completed and saved the full Worker Profile on Windows.

### LATER-OWNER-002

The same owner pass found invisible Profile control boundaries and high-severity production-path transitive dependency findings. Pull request #7 added visible controls, focus/disabled/error states, pinned PostCSS `8.5.18` and Sharp `0.35.3`, added deterministic dependency floors and required `npm audit --omit=dev --audit-level=high`. Exact-head CI and owner retest passed. M1.01 is DONE.

## M1.02 design system and global UX

Pull request #8 introduced semantic design tokens, shared controls and feedback, accessible table/dialog primitives, mobile Worker navigation, keyboard/focus/validation behavior, high-contrast/forced-colour/reduced-motion rules, live adoption across Worker routes and permanent design-system validation.

## LATER-OWNER-003 — Windows portable preview symlink

The owner tested commit `ebb06e4` on Windows with Node.js `v22.23.1`. Installation, application validation and production build passed, but `npm run preview:smoke` attempted to recreate a traced PGlite symbolic link and Windows returned:

```text
EPERM: operation not permitted, symlink
```

Pull request #9 was squash-merged as `d849ec933f61c5296a3fc981ef57e470445f2ee1`. It replaced symlink-preserving preview copying with a portable builder that materializes traced packages as ordinary files/directories, cleans partial bundles, rejects remaining symbolic links, verifies PGlite inclusion, checks `/` and `/worker/login`, and waits for shutdown.

## LATER-OWNER-004 — runtime smoke and production output collision

During the next Windows retest, `npm run check` passed through standalone TypeScript, ESLint and protected PGlite runtime smoke. Production build then failed on a partially generated development validator:

```text
.next/dev/types/validator.ts:89:1
Type error: Cannot find name 'er'.
```

The ordering proved the runtime smoke had launched `next dev` in the same `.next` directory later consumed by `next build`.

Pull request #10 was squash-merged as `ef2d623192e9da3b822ed0114d633fb788660d17`. It isolated runtime output, added Windows process-tree termination, cleaned stale development types before typecheck/build and added the exact malformed-validator regression.

## LATER-OWNER-005 — automated commands changed tracked source

After PR #10, the owner deliberately recreated the malformed validator and confirmed recovery. The complete `npm run check` passed, but the required post-gate repository check reported:

```text
 M next-env.d.ts
 M tsconfig.json
```

The gate was therefore not deterministic even though compilation succeeded.

## Pull request #11 — automated Next subsystem rewrite

The owner rejected another narrow patch. PR #11 was squash-merged as `36e1cfc9c5395cffbce330c56cfbbe19fca4871a` and replaced automated type generation, protected runtime smoke and production build configuration:

- `next-env.d.ts` became generated, ignored and untracked;
- root `tsconfig.json` used committed stable values;
- type generation used `.next-typecheck`;
- protected runtime smoke used `.next-runtime-smoke`;
- production build alone used `.next`;
- automated modes received ignored generated TypeScript configs under `.hse-next`;
- package manifest, lockfile, Next config and root TypeScript config were hashed before and after automated commands;
- protected source mutation failed the command;
- obsolete partial-cleanup code was deleted;
- four architecture/mode/mutation/cleanup regressions entered `npm run check`.

Final PR #11 source head `c8d59a9b1ee97ec9d72f5c77484f33c4505b4527` / merge head `27a4989dc27720fe0cda5643f993ccf05ac3ac0a` passed workflow run `30743937853`, job `91486183017`. The artifact contained 1,630 files, was 20,139,143 bytes and had SHA-256:

```text
a8992880f78b3171015f242f9c778ab6d96481d3ad5c606586935ba9db818228
```

## LATER-OWNER-006 — ordinary development still rewrote `tsconfig.json`

During the next Windows owner retest on Node.js `v22.23.1`, the owner started the real application with:

```cmd
npm run dev
```

After opening Worker routes, stopping the server and running:

```cmd
git diff -- tsconfig.json package.json package-lock.json next.config.ts
```

Git showed that tracked root `tsconfig.json` had been reformatted and changed from:

```text
"jsx": "preserve"
```

to:

```text
"jsx": "react-jsx"
```

The LF-to-CRLF warning was not the defect. The substantive tracked configuration mutation was the defect.

### Root cause

PR #11 protected automated typecheck, runtime smoke and production build, but `package.json` still mapped the ordinary developer command directly to `next dev`. The default Next configuration therefore still used the tracked root `tsconfig.json`. The owner’s manual development path was outside the protected command-mode system and had no automated route/start/stop cleanliness test.

A complete re-read also found that each generated automated TypeScript config included its own route-type directory while excluding the same directory. That contradiction was corrected rather than preserved.

## Pull request #12 — protected ordinary development

PR #12 was squash-merged as `4f04a525f39f203f6def7915647c68a6718303a8` and added the missing normal-development boundary.

### Architecture

- `npm run dev` invokes `node scripts/run-development.mjs`; raw `next dev` is prohibited by regression.
- Ordinary development output uses `.next-development`.
- Next receives `.hse-next/development/tsconfig.json`, never tracked root `tsconfig.json`.
- Development, typecheck, runtime smoke and production build use separate generated-config subdirectories.
- Generated configs exclude other mode outputs but do not exclude their own generated route types.
- `.next-development` is ignored by Git and ESLint.
- The development runner snapshots SHA-256 digests of `package.json`, `package-lock.json`, `next.config.ts` and `tsconfig.json` before startup.
- Ctrl+C initiates full process-tree shutdown on Windows.
- After shutdown, the runner verifies every protected digest is unchanged.
- `.next-development` and `.hse-next/development` are removed on success, signal and failure.
- Shutdown timeouts are cleared when the process exits, preventing completed tests from keeping Node alive unnecessarily.

### Permanent regression and real-server smoke

The Next-system architecture suite proves:

1. `.next-development` and its generated config are ignored;
2. `npm run dev` cannot point directly to `next dev`;
3. development uses its own generated config and output;
4. a mode never excludes its own generated route types;
5. all mode workspaces are removed by full cleanup;
6. protected source mutation remains detectable.

A `test:development` stage starts the same protected ordinary-development runner used by `npm run dev`, obtains a free port, requests the real `/worker/login` route, requires HTTP 200, shuts down, verifies protected source hashes and removes the development workspace.

Final PR #12 source head `bb8aad20f7dd5a20201d05deef9b735977ca0101` / merge head `ee8d11311ea7f8e22e6a0d36e64438708a44d8da` passed workflow run `30745665336`, job `91490717539`.

The decisive success line was:

```text
Normal development mode smoke passed with HTTP 200, isolated output, clean shutdown and unchanged source configuration.
```

The final PR #12 artifact was 20,139,133 bytes, artifact ID `8832793543`, SHA-256:

```text
e2f5ef4ca9150f385f16c165378538c06f49ac80e5219086ac8cf05338cdfbc1
```

## LATER-OWNER-007 — Worker Profile page-wide horizontal overflow

The next Windows owner test used commit `362793d`, Windows 10, Node.js `v22.23.1`, Google Chrome, normal desktop browser width and 100% zoom.

At:

```text
http://localhost:3000/worker/profile
```

the owner observed:

1. a page-wide horizontal scrollbar;
2. Profile layout extending beyond the right edge;
3. the Ready to submit panel clipped;
4. the Submit profile button partly outside the visible viewport;
5. horizontal scrolling moving the entire application and sidebar off screen;
6. header controls and Profile content not contained;
7. no correction from `Ctrl+0` or `Ctrl+F5`.

This proved a real desktop width-model defect, not only a mobile, zoom or cache problem.

### Root causes

A full shell/Profile/style review found:

- the portal shell correctly used a 260px sidebar plus a shrinkable main track, but width containment was not repeated through every descendant boundary;
- Profile breakpoints used the full viewport, not the Profile container remaining after sidebar and portal padding;
- the action/history track used `minmax(300px, 0.55fr)`, retaining a fixed 300px minimum;
- cards, forms, heading children and action descendants did not all have zero minimum inline size;
- the history table had a scroll wrapper, but ancestor intrinsic-width contracts still allowed the table to influence document width.

## Pull request #13 — shell/Profile width-model rewrite

PR #13 replaces the defective width model rather than hiding overflow.

### Shell containment

- A dedicated `layout-containment.css` loads before Profile styles.
- Portal shell, main column, header, content and direct content children use explicit `width: 100%`, `min-width: 0` and `max-width: 100%` boundaries.
- The desktop sidebar remains 260px but cannot enlarge the document.
- Header descendants can shrink, and nonessential profile-summary text is removed before controls clip.
- The repair explicitly avoids `overflow-x: hidden` or `clip` on `body` and the complete portal shell.

### Profile containment and reflow

- `.profile-page` becomes the named `worker-profile` inline-size container.
- Profile cards, grid children, forms, fields, headings, status copy and action descendants receive explicit width/shrink containment.
- The main Profile layout becomes:

```text
minmax(0, 1fr) minmax(16rem, 22rem)
```

- The old fixed 300px action-column minimum is prohibited.
- At a 62rem Profile-container width, summary, editor/action layout and aside stack.
- At 46rem, steps, summary facts, field grids and action controls become single-column.
- Viewport media-query fallbacks remain for browsers without container-query support.
- Ready to submit and Submit profile are bounded to the action card.

### Table-only scrolling

- The Profile history card contains intrinsic width.
- The history `.ds-table-wrap` is the only Profile element with `overflow-x: auto`.
- The 36rem table minimum is preserved for readable columns but can scroll only inside its bordered region.
- Table overscroll is contained and cannot move the shell, header or page.

### Permanent overflow regression

`test:profile-overflow` is added to the complete `npm run check` chain.

It verifies four contracts:

1. Worker shell and Profile keep shrink containment through every layout boundary.
2. Profile history owns the only horizontal scroll region.
3. Profile action controls remain bounded by their cards.
4. Required desktop, tablet, mobile and zoom widths switch before clipping.

The modeled acceptance matrix includes:

- normal 1366px desktop at 100%;
- 860px;
- 768px;
- 390px;
- 320px;
- 125%, 150% and 200% zoom.

### First complete technical run

PR #13 source head `f10f01d28ddad0a8215ee49d7a3f0f254de9567f` / merge head `16c66ded2c03a1b16ca39f8a4ff342e99c91a2f2` passed workflow run `30747176028`, job `91494637373`:

1. locked installation of 349 packages;
2. environment, route, design-system and enhanced Profile UX checks;
3. PostCSS `8.5.18` and Sharp `0.35.3` security floors;
4. production audit with `found 0 vulnerabilities`;
5. five Profile tests;
6. five platform/migration/concurrency/rollback tests;
7. four Profile overflow contracts;
8. portable preview-copy regression;
9. four Next-system regressions;
10. isolated `next typegen` and strict TypeScript;
11. ESLint;
12. normal-development `/worker/login` HTTP 200 and clean shutdown;
13. protected PGlite application runtime;
14. deterministic Next.js `16.2.12` production build;
15. portable PGlite bundle verification;
16. standalone `/` and `/worker/login` HTTP 200;
17. preview shutdown;
18. release manifest;
19. complete 1,630-file artifact upload.

The overflow success lines included:

```text
Worker Profile fields, container reflow, shell shrink containment, bounded actions and table-only horizontal scrolling passed.
```

and four passing tests with zero failures.

The first PR #13 artifact was 20,139,472 bytes, artifact ID `8833257504`, SHA-256:

```text
50db11fcdbb8791df838a523ed67f0961ef4f86d4f62ec8e61d0ab870c3e99a2
```

Governance records and the focused Windows retest document require a final exact-head workflow before merge.

## Current acceptance boundary

M1.02 remains **IMPLEMENTED — OWNER RETEST REQUIRED**.

The owner must complete:

- `docs/testing/M1_02_DEVELOPMENT_CONFIG_RETEST.md`;
- `docs/testing/M1_02_PROFILE_OVERFLOW_RETEST.md`;
- unfinished portable preview/full-rewrite sections;
- every unfinished browser/accessibility section in `docs/testing/M1_02_DESIGN_SYSTEM_HARD_TEST.md`.

The Profile overflow retest requires objective `documentElement.scrollWidth`/`clientWidth` evidence at normal desktop, 860px, 768px, 390px, 320px and 125%/150%/200% zoom. The document must not scroll horizontally. Sidebar, header, Profile cards, Ready to submit and Submit profile must remain contained. Only the Profile history table may scroll horizontally inside its own region.

The wider Windows gate must leave tracked source clean after automated and manual development, type generation, full application validation, production build and repeated portable preview. It must require neither Administrator privileges nor Developer Mode.

M1.03 remains blocked. This repair does not claim production authentication/OTP, tenant authorization, immutable audit/outbox delivery, secure evidence uploads, Worker Identity review or live provider credentials.
