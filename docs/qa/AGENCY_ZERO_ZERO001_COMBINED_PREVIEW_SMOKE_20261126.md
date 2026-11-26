# ZERO-001 M1.01.04 — combined candidate offline portable preview smoke

Approved application source pin SHA7ff30ea remains unchanged. This QA-only correction is proposed as a stacked draft on PR250 (migration-lock review), not merged/deployed or repinned.

**Genuine red:** compiled production Next standalone on QA candidate SHAa8c239 under old scripts/smoke-preview.mjs forced HSE_APP_ENV=test/PGlite. Production validator intentionally rejects this, causing recovery HTTP500 (test harness red, not a demonstrated product security weakness), raw SHA256 19dfd95afd3fe2c97101bec903925015cc6627be69a3b78e82bb3c79eae18131.

**Single QA script change:** copy exact bytes scripts/smoke-preview.mjs from previously reviewed draft PR248 QA source SHA510498f045661a1cd9a889628e760a089d8b7010. It launches compiled standalone with valid HSE_APP_ENV=preview / Postgres, a deliberately inaccessible loopback DB port 9, generated test-only session/pepper, removes inherited HSE_* providers and sets both demo and auth sandbox off. The application production validator remains untouched.

**Genuine green:** after compiling exact base QA candidate SHAa8 (standalone present), actual portable offline HTTP smoke PASS exit0. Root HTTP200, six role login pages HTTP200, Worker registration and recovery HTTP200, two sandbox routes HTTP404, five protected portal redirects correct, compiled server stopped. No database attached; no authenticated cross-role journey or live provider claimed. Raw SHA256 081b6f983a52e9f4865ef062d5f8b8b8694f95e4cbdf995bb99ca5aceab2cafa.

**ENGINEER:** Scoped PASS actual compiled Next HTTP; **CYBERSECURITY:** Scoped PASS production/test fail-closed intact, generated non-provider credentials, sandbox disabled; manual pentest untested; **REVIEWER:** AI verified raw red/green, prior unchanged test source, and no-db scope; independent owner signoff pending. Full scenario increment 0, ZERO-001 remains 0/4 and overall0/218.

Private receipt: /home/ubuntu/work/.hse-qa-tmp/agency-zero-sequential-closure-001/ZERO001-M10104-PORTABLE-SMOKE-INTEGRATED-ECR-20261126.json.
