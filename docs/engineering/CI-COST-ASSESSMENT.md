# HSE Verify — CI Cost and Credit Assessment

## Rating

**CI cost risk: MEDIUM**

## Reason

The mandatory full gate is intentionally substantial because this is a security-sensitive, multi-role, multi-tenant platform. One successful run performs:

- locked dependency installation;
- source, type, lint, dependency-floor and production-audit checks;
- domain, migrated database, concurrency, authentication and authorization suites;
- multiple real Next.js development/runtime startups;
- deterministic production build;
- standalone deployable-preview startup;
- release-manifest generation;
- concise manual-handoff generation.

The completed installation run took about two minutes on a GitHub-hosted Linux runner. The deployable preview artifact was about 21 MB.

## Controls

- Run once on pull requests to `main`.
- Run once after merge/push to `main`.
- Allow explicit manual runs through `workflow_dispatch`.
- Do not run the same full gate again merely because the feature branch was pushed while an open pull request already exists.
- Cancel superseded runs on the same ref.
- Use npm dependency caching.
- Keep a 25-minute timeout.
- Retain engineering evidence for seven days.
- Do not call an AI API from CI.
- Do not upload the whole repository, dependency cache, successful terminal log, screenshots, traces, or video.
- Use `verify:quick` and `verify:affected` during development, while `verify:full` remains mandatory before handoff.

## Preview artifact exception

The `.preview-bundle` contains only the traced application and runtime packages needed to execute the provider-neutral release candidate. It is a deployable product artifact, not an npm cache or an arbitrary upload of `node_modules`.

The permanent exact-ref rollback workflow retains its candidate for 30 days because rollback evidence has a different operational purpose from routine pull-request evidence.

## AI-credit impact

Stored standards, matrices, result JSON, and the concise handoff do not continuously consume AI credits. Credit use is reduced by giving the AI developer the failed command, failed test, first useful error, and affected files instead of replaying complete successful logs.
