# M2.04 Question Bank Implementation Plan

> Required workflow: executing-plans + TDD + systematic debugging + verification-before-completion. Merge only an exact verified head.

**Goal:** Build the authoritative reusable assessment question bank with immutable versions, six supported question types, framework/domain metadata, strict type-specific validation and a delivery-safe projection that can never leak answer keys or written rubrics.

**Base:** verified/merged M2.03 main `0ce1793845fb0fee6f040ae11eae721cb518b380`.

## Owned scope

M2.04 owns stable Question records, immutable Question Versions, admin creation/revision/status management, content de-duplication, framework/domain/tags/difficulty metadata, answer/rubric storage, and a delivery-safe projection for later form generation.

It does **not** own randomized forms, Worker attempt state, scoring, submissions, eligibility or assignments. Those remain M2.05+.

## Required question types

- `MULTIPLE_CHOICE`
- `TRUE_FALSE`
- `SHORT_TEXT`
- `LONG_TEXT`
- `INTEGER`
- `DECIMAL`

## Invariants

- Stable question identity survives revisions; every revision creates a new immutable version.
- `assessment_questions.current_version_id` points to exactly one immutable version.
- Question status is `ACTIVE` or `INACTIVE`; status changes never delete versions.
- Admin mutations require a live fixed `admin` session and `platform.operations.manage` at the route boundary.
- Browser forms never supply creator identity, version number, content hash, current-version authority or audit actor authority.
- Normalized content fingerprints reject duplicate active semantic question content across the bank.
- MCQ requires at least two unique non-empty options and an answer that exactly names one option.
- TRUE_FALSE requires a boolean answer.
- INTEGER requires a finite integer answer.
- DECIMAL requires a finite numeric answer.
- SHORT_TEXT and LONG_TEXT require a non-empty scoring rubric; written questions do not use hidden generic auto-answer strings.
- Delivery projection includes prompt/type/options/public metadata only. It must never include `answer_key`, rubric, scoring metadata, creator IDs or internal content hashes.
- Optimistic revision uses the expected current version ID. Under concurrent revisions, exactly one writer wins and all stale writers fail.
- Version rows are append-only; UPDATE/DELETE tampering fails at the database boundary.
- Migration down is history-preserving.

## TDD sequence

1. RED source contract for schema, six types, admin authorization, safe projection and no M2.05/M2.07 authority.
2. GREEN migration/domain/service skeleton.
3. RED real PGlite runtime tests for six valid types and each invalid type shape.
4. GREEN validation/persistence and content fingerprinting.
5. RED duplicate-content, revoked-admin and eight-way stale revision race tests.
6. GREEN live-admin mutation, optimistic concurrency and explicit audit events.
7. RED delivery DTO leakage tests and append-only tamper tests.
8. GREEN delivery-safe read projection and minimal `/admin/question-bank` surface.
9. Hard targeted gate: contract + production-module PGlite runtime + strict TypeScript + lint.
10. Full Engineering gate, exact-head PR promotion and merge. Verify resulting main before M2.05.
