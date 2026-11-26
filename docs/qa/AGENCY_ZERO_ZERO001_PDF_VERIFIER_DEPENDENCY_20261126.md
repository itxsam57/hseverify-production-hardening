# ZERO-001 M1.01.03 — mandatory signed PDF text verification dependency

Approved original application source pin 7ff30ea remains unchanged. This is a QA-only change, stacked after drafts 251,250,249. No merge, staging or production mutation, no TECH FULL awards.

Actual terminal red: exact QA SHA9a36932 independent full audit GitHub run 45793227295 FAIL, one critical zero high. Four credential PDF and validity tests failed: spawned pdftotext status null when expected0. Independent full audit installs Chromium but omitted Poppler pdftotext provision; the existing masterplan workflow installs and checks this tool. Missing binary is strongly supported, but final hosted retest is required. Raw CI full regression hash 671284c5f88ea81e85fe0556d7a9f918915a6ffae409ddb0ea72402b737ed0a6.

Workstation witness: same four targeted real signed Unicode PDF issuance, terminal-hyphen preservation, UTC validity and renewal-history PDF cases PASS4/4, no skips, with installed /usr/bin/pdftotext. Raw TAP SHA256 4dfa0e31b95425ba0081c442e0235d9198ef65210dee071591e3fe01eed55e94.

QA-only remedy in .github/workflows/independent-full-system-audit.yml: install poppler-utils if pdftotext unavailable, require command -v pdftotext and pdftotext -v before full regression; preserve every PDF assertion, full regression and nonzero gate. YAML22 steps and all shell snippets syntax pass.

ENGINEER: Scoped PASS local PDF4/4 and workflow parse. CYBERSECURITY: Signed credential PDF checks not waived, missing required binary fails CI. REVIEWER: Exact hosted failure and local evidence reviewed, new exact hosted CI remains pending. ZERO-001 0/4 TECH FULL, original 0/218. No production writes.
