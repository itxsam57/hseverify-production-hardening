# 08 — CI Cost and AI Credit Standard

## Separate CI cost from AI credit

CI runners execute commands. AI credits are consumed when an AI model reads, reasons about, or modifies content.

A stored report does not continuously consume AI credits. Repeatedly sending huge logs to an AI does.

## CI economy

- Cancel superseded runs on the same branch.
- Cache dependencies using supported methods.
- Run cheap checks before expensive tests.
- Use focused tests during development and full tests before handoff.
- Use reasonable timeouts.
- Upload evidence only on failure.
- Keep artifacts for about 7 days unless the project requires otherwise.
- Do not upload dependencies, build caches, or the whole repository as artifacts.
- Do not run broad browser matrices on every trivial documentation change.
- Do not call AI APIs from CI.

## Browser evidence

Recommended defaults:

- screenshots: failure only;
- traces: failure or first retry;
- video: off unless useful, otherwise failure only;
- HTML report: failure or short retention;
- sensitive data: always redacted or synthetic.

## AI-credit economy

The AI developer should receive:

- failed command;
- failed test name;
- first useful error;
- relevant file and line;
- short stack excerpt;
- reproduction information;
- trace or screenshot only when needed.

Avoid repeatedly processing:

- full successful build logs;
- thousands of dependency-install lines;
- complete coverage output;
- every passing test;
- duplicate screenshots;
- the entire repository for a one-file defect;
- the full engineering handbook on every small task.

## Report storage

Keep permanent standards and regression records in the repository.

Normally do not commit generated items:

```text
.reports/
playwright-report/
test-results/
coverage/
screenshots/
videos/
traces/
full-terminal-logs/
```

Add generated folders to `.gitignore` and expose concise results through CI summaries and the AI's final handoff.

## Cost-risk rating

The developer must label CI cost risk:

- **Low:** static checks, unit tests, one browser, failure-only artifacts.
- **Medium:** multiple services, integration database, several browsers, moderate artifacts.
- **High:** long-running end-to-end suites, large browser/device matrices, paid external services, heavy builds, or frequent scheduled runs.

Explain the reason and optimize before accepting a high-risk setup.
