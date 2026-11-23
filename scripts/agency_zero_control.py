#!/usr/bin/env python3
"""ZERO agency QA: one frozen Masterplan inventory, at most five test units/batch.

Read-only by default; --generate writes only the deterministic batch manifest.
A scoped smoke PASS is never a technical FULLY_VERIFIED verdict.
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs/qa/evidence/MASTERPLAN_218_ALL_PREVIOUS_EVIDENCE_ACTIONS_20261114.csv"
HISTORICAL = ROOT / "docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json"
MANIFEST = ROOT / "docs/qa/AGENCY_ZERO_BATCHES.json"
EVIDENCE = ROOT / "docs/qa/AGENCY_ZERO_EVIDENCE.json"
CANDIDATE = ROOT / "docs/qa/AGENCY_ZERO_CANDIDATE.json"
CURSOR = ROOT / "docs/qa/AGENCY_ZERO_CURSOR.json"
MAX_ITEMS = 5
SHA_PATTERN = re.compile(r"^[a-f0-9]{40}$")
TEST_CASE_PATTERN = re.compile(r"^tests/[A-Za-z0-9_./-]+[.]test[.]mjs#[a-f0-9]+$")


def load_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def exact_sha():
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def pinned_candidate_sha():
    """Pin app code separately from documentation/evidence QA branch commits.

    Reject any actual changed application runtime/configuration until the
    owner-reviewed candidate is explicitly repinned and affected tests rerun.
    """
    candidate = load_json(CANDIDATE)
    sha = candidate.get("source_commit_sha", "")
    if candidate.get("schema_version") != 1 or not SHA_PATTERN.fullmatch(sha):
        raise ValueError("Invalid pinned application candidate SHA")
    git = ["git", "rev-parse", "--verify", sha + "^{commit}"]
    found = subprocess.run(git, cwd=ROOT, capture_output=True, text=True, check=False)
    if found.returncode != 0:
        raise ValueError("Pinned application commit missing from checked-out Git history")
    app_paths = ["src/", "database/", "public/", "config/", "ops/", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "eslint.config.mjs", ".env.example", "scripts/build-production.mjs", "scripts/run-development.mjs"]
    diff = subprocess.check_output(["git", "diff", "--name-only", sha, "HEAD", "--", *app_paths], cwd=ROOT, text=True)
    if diff.strip():
        raise ValueError("Pinned application candidate has runtime drift; retarget candidate and selectively recheck: " + ", ".join(diff.splitlines()[:10]))
    return sha


def manifest_from_source():
    with SOURCE.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != 218:
        raise ValueError(f"Frozen scenario inventory changed: {len(rows)} != 218")
    ids = [row["frozen_id"] for row in rows]
    if len(set(ids)) != 218 or any(not re.fullmatch(r"M[123][.]\d{2}[.]\d{2}", item) for item in ids):
        raise ValueError("Frozen scenario IDs are missing, duplicated, or malformed")
    historical = load_json(HISTORICAL)
    original_cases = {case["case_id"]: case for case in historical["cases"]}
    linked = {entry["id"]: entry for entry in historical["scenarios"]}
    if set(ids) != set(linked):
        raise ValueError("Existing source-case index does not cover the same 218 frozen IDs")
    by_brick = collections.OrderedDict()
    for row in rows:
        if row["brick"] != ".".join(row["frozen_id"].split(".")[:2]):
            raise ValueError(f"Brick mismatch: {row['frozen_id']}")
        by_brick.setdefault(row["brick"], []).append(row)
    if len(by_brick) != 37:
        raise ValueError(f"Frozen brick count changed: {len(by_brick)} != 37")
    batches = []
    for brick, brick_rows in by_brick.items():
        for start in range(0, len(brick_rows), MAX_ITEMS):
            selected = brick_rows[start:start + MAX_ITEMS]
            units = []
            for row in selected:
                old = linked[row["frozen_id"]]
                case_ids = old.get("linked_case_ids", [])
                for cid in case_ids:
                    if cid not in original_cases:
                        raise ValueError(f"Invalid previous case ID {cid}")
                candidate = next((original_cases[cid] for cid in case_ids
                                  if TEST_CASE_PATTERN.fullmatch(cid)
                                  and (ROOT / original_cases[cid]["file"]).is_file()), None)
                units.append({
                    "scenario_id": row["frozen_id"],
                    "workflow": row["scenario"],
                    "required_roles": row["required_roles"].split("; ") if row["required_roles"] else [],
                    "historical_linked_case_count": len(case_ids),
                    "sample_existing_case": ({
                        "case_id": candidate["case_id"],
                        "path": candidate["file"],
                        "test_title": candidate["title"],
                    } if candidate else None),
                })
            batches.append({
                "batch_id": f"ZERO-{len(batches)+1:03d}",
                "brick": brick,
                "family": selected[0]["family"],
                "unit_count": len(units),
                "units": units,
            })
    return {
        "schema_version": 1,
        "purpose": "Owner testing readiness, not final provider-live/production release authorization",
        "canonical_scenario_source": SOURCE.relative_to(ROOT).as_posix(),
        "historical_case_source": HISTORICAL.relative_to(ROOT).as_posix(),
        "max_scenarios_or_scheduled_cases_per_batch": MAX_ITEMS,
        "original_scenario_count": len(ids),
        "original_brick_count": len(by_brick),
        "batch_count": len(batches),
        "historical_scenarios_with_direct_source_case_link": sum(bool(linked[s].get("linked_case_ids")) for s in ids),
        "historical_scenarios_without_direct_source_case_link": sum(not bool(linked[s].get("linked_case_ids")) for s in ids),
        "batches": batches,
    }


def validate_manifest(document):
    pinned_candidate_sha()
    expect = manifest_from_source()
    if document != expect:
        raise ValueError("Agency batch manifest differs from frozen queue. Regenerate intentionally and review diff")
    units = [unit for batch in document["batches"] for unit in batch["units"]]
    if len(units) != 218 or len(set(unit["scenario_id"] for unit in units)) != 218:
        raise ValueError("Every original scenario must appear exactly once")
    if any(not (1 <= batch["unit_count"] <= MAX_ITEMS)
           or batch["unit_count"] != len(batch["units"]) for batch in document["batches"]):
        raise ValueError("Batch exceeds 5 cases or does not match the registered count")
    active_batch_cursor(document)
    return document


def active_batch_cursor(manifest):
    """Progress of *attempted batches* is separate from fully verified outcomes.

    Failed or blocked cases remain parked and reviewable while the queue advances.
    """
    state = load_json(CURSOR)
    if state.get("schema_version") != 1 or state.get("application_source_sha") != pinned_candidate_sha():
        raise ValueError("ZERO batch cursor source candidate or schema mismatch")
    batches = manifest["batches"]
    attempted = state.get("attempted_batches")
    if not isinstance(attempted, list) or len(attempted) > len(batches):
        raise ValueError("Invalid ZERO attempted batch list")
    for i, receipt in enumerate(attempted):
        if not isinstance(receipt, dict) or receipt.get("batch_id") != batches[i]["batch_id"]:
            raise ValueError("Attempted batch sequence differs from frozen queue")
        if receipt.get("state") not in ("EVIDENCE_RECORDED_INCOMPLETE", "TECHNICALLY_CONFIRMED"):
            raise ValueError("Batch requires an honest recorded state")
        if not receipt.get("report_file") or not (ROOT / receipt["report_file"]).is_file():
            raise ValueError("Missing attempted batch evidence report")
    next_batch = batches[len(attempted)]["batch_id"] if len(attempted) < len(batches) else None
    if state.get("next_batch_id") != next_batch:
        raise ValueError("ZERO next batch cursor skips or restarts queued work")
    held = state.get("revisit_batches", [])
    if not isinstance(held, list) or any(x not in [r["batch_id"] for r in attempted] for x in held):
        raise ValueError("Unresolved batches must refer to actually attempted ones")
    return state


def current_evidence(manifest):
    """Only fully traceable independent expert attestations count for this SHA.

    This is a schema/provenance gate, not a substitute for reviewing original logs.
    """
    receipts = load_json(EVIDENCE)
    if receipts.get("schema_version") != 1 or not isinstance(receipts.get("technical_attestations"), list):
        raise ValueError("Invalid ZERO evidence structure")
    original = {unit["scenario_id"] for batch in manifest["batches"] for unit in batch["units"]}
    accepted = {}
    for entry in receipts["technical_attestations"]:
        scenario = entry.get("scenario_id")
        sha = entry.get("source_sha")
        if scenario not in original or not SHA_PATTERN.fullmatch(sha or ""):
            raise ValueError("Evidence uses a foreign scenario or invalid exact SHA")
        if not re.fullmatch(r"[a-f0-9]{64}", entry.get("configuration_fingerprint") or ""):
            raise ValueError("Technical receipt needs an exact SHA256 configuration fingerprint")
        raw = entry.get("raw_evidence_refs")
        if not isinstance(raw, list) or not raw:
            raise ValueError("Technical receipt must reference reviewable raw evidence")
        if any(not isinstance(x, dict) or not isinstance(x.get("uri"), str)
               or not x.get("uri").strip() or not re.fullmatch(r"[a-f0-9]{64}", x.get("sha256") or "")
               for x in raw):
            raise ValueError("Every raw artifact reference must contain URI and SHA256")
        gates = entry.get("gates", {})
        gate_names = ("engineering", "functional_workflow", "ui_accessibility",
                      "cybersecurity", "independent_review", "adapter_contracts")
        if not isinstance(gates, dict) or any(gates.get(name) not in ("PASS", "NOT_APPLICABLE", "FAIL", "BLOCKED")
                                                   for name in gate_names):
            raise ValueError(f"Every evidence dimension needs a real verdict for {scenario}")
        for required in gate_names[:-1]:
            if gates[required] != "PASS":
                break
        else:
            if gates["adapter_contracts"] not in ("PASS", "NOT_APPLICABLE"):
                continue
            if scenario.startswith("M3.10.") and gates["adapter_contracts"] != "PASS":
                continue
            if gates["adapter_contracts"] == "NOT_APPLICABLE" and not entry.get("adapter_not_applicable_reason"):
                raise ValueError("Non-applicable adapter needs a reason")
            if entry.get("technical_verdict") != "FULLY_VERIFIED":
                continue
            if entry.get("open_high_or_critical") != 0 or entry.get("blocking_defects"):
                continue
            if not isinstance(entry.get("tested_actions"), list) or not entry["tested_actions"]:
                raise ValueError("Technical signoff requires specific actual tested actions")
            reviewers = entry.get("reviewers")
            if not isinstance(reviewers, dict):
                raise ValueError("Three specialist reviews required")
            signers = []
            for discipline in ("engineering", "cybersecurity", "independent_review"):
                review = reviewers.get(discipline)
                if not isinstance(review, dict) or not review.get("reviewer_id") or not review.get("decision") == "PASS" or not re.fullmatch(r"[a-f0-9]{64}", review.get("evidence_sha256") or ""):
                    raise ValueError(f"Missing independently attributable {discipline} review")
                signers.append(review["reviewer_id"])
            if len(set(signers)) != len(signers):
                raise ValueError("Independent expert review must not share the same reviewer identity")
            accepted[(scenario, sha)] = entry
    return accepted

def status(manifest):
    accepted = current_evidence(manifest)
    sha = pinned_candidate_sha()
    passed = {sid for (sid, source_sha) in accepted if source_sha == sha}
    total = manifest["original_scenario_count"]
    cells = round(20 * len(passed) / total)
    bar = "█" * cells + "░" * (20 - cells)
    cursor = active_batch_cursor(manifest)
    print(f"ZERO | TECH FULLY VERIFIED {len(passed)}/{total} [{bar}] | LEFT {total-len(passed)} | OWNER TEST READY {'YES' if len(passed)==total else 'NO'}")
    print(f"ZERO | BATCHES ATTEMPTED {len(cursor['attempted_batches'])}/{len(manifest['batches'])} (MAX 5) | APP SHA {sha[:8]} PINNED | NEXT {cursor['next_batch_id'] or 'REVISIT OPEN ISSUES'} | OPEN PRIOR BATCHES {len(cursor['revisit_batches'])}")
    older = {sid for (sid, prior_sha) in accepted if prior_sha != sha and sid not in passed}
    print(f"ZERO | PRIOR-SHA TECH RECEIPTS {len(older)} (targeted revalidation needed) | Historic source test greens do NOT count")


def find_batch(manifest, batch_id):
    matches = [x for x in manifest["batches"] if x["batch_id"] == batch_id]
    if len(matches) != 1:
        raise ValueError(f"Unknown batch ID: {batch_id}")
    return matches[0]


def run_scoped_smokes(manifest, batch_id, output_dir, max_seconds):
    batch = find_batch(manifest, batch_id)
    output_dir.mkdir(parents=True, exist_ok=True)
    sha = pinned_candidate_sha()
    tooling_sha = exact_sha()
    outcomes = []
    for unit in batch["units"]:
        case = unit["sample_existing_case"]
        if case is None:
            outcomes.append({"scenario_id": unit["scenario_id"], "status": "NO_DIRECT_TEST_CASE_LINK",
                             "technical_fully_verified": False})
            continue
        path = (ROOT / case["path"]).resolve()
        if not path.is_file() or not path.is_relative_to((ROOT / "tests").resolve()):
            raise ValueError(f"Unsafe test path: {case['path']}")
        cmd = ["node", "--test", "--test-reporter=tap",
               "--test-name-pattern", "^" + re.escape(case["test_title"]) + "$", str(path)]
        env = os.environ.copy()
        env.update({"HSE_APP_ENV": "test", "HSE_DATABASE_DRIVER": "pglite",
                    "HSE_PGLITE_DATA_DIR": "memory://", "NEXT_TELEMETRY_DISABLED": "1",
                    "HSE_ENABLE_AUTH_SANDBOX": "false", "HSE_ENABLE_WORKER_DEMO_AUTH": "false",
                    "HSE_USE_WORKER_DEMO_DATA": "false"})
        try:
            result = subprocess.run(cmd, cwd=ROOT, env=env, text=True,
                                    capture_output=True, timeout=max_seconds, check=False)
            stdout = result.stdout + "\n" + result.stderr
            metrics = {}
            for name in ("pass", "fail", "skip", "cancelled"):
                occurrences = re.findall(r"(?m)^# " + name + r" (\d+)\s*$", stdout)
                metrics[name] = int(occurrences[-1]) if occurrences else None
            if result.returncode == 0 and metrics["pass"] == 1 and metrics["fail"] == 0:
                verdict = "SCOPED_SMOKE_PASS_NOT_FULL_VERIFICATION"
            elif metrics["pass"] is not None and metrics["pass"] + (metrics["fail"] or 0) > 1:
                verdict = "INVALID_MULTIPLE_TESTS_MATCHED"
            else:
                verdict = "SCOPED_SMOKE_FAILED_OR_NOT_EXECUTED"
            outcomes.append({
                "scenario_id": unit["scenario_id"], "status": verdict,
                "selected_case_id": case["case_id"],
                "exit_code": result.returncode, "metrics": metrics,
                "output_sha256": hashlib.sha256(stdout.encode()).hexdigest(),
                "technical_fully_verified": False,
            })
        except subprocess.TimeoutExpired:
            outcomes.append({"scenario_id": unit["scenario_id"], "status": "TIMEOUT",
                             "selected_case_id": case["case_id"], "technical_fully_verified": False})
    report = {
        "report_type": "SCOPED_ONLY_NOT_AGENCY_CERTIFICATION",
        "batch_id": batch_id, "source_sha": sha, "qa_tooling_sha": tooling_sha,
        "run_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "scheduled_test_cases": sum(x["sample_existing_case"] is not None for x in batch["units"]),
        "max_scheduled_test_cases": MAX_ITEMS,
        "all_review_gates": "NOT_PERFORMED",
        "technical_fully_verified_awarded": 0,
        "results": outcomes,
    }
    location = output_dir / f"{batch_id}.json"
    location.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"ZERO | {batch_id} | {batch['family']} | {len(outcomes)} CASES | evidence {location}")
    for unit in outcomes:
        print(f"ZERO | {unit['scenario_id']} | {unit['status']}")
    print("ZERO | Technical certification: NONE from smoke tests; review, workflow and pentest remain required")
    if any(x["status"] != "SCOPED_SMOKE_PASS_NOT_FULL_VERIFICATION" for x in outcomes):
        return 2
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument("--generate", action="store_true")
    operation.add_argument("--check", action="store_true")
    operation.add_argument("--status", action="store_true")
    operation.add_argument("--matrix", metavar="ZERO-001 or ALL")
    operation.add_argument("--batch", metavar="ZERO-001")
    operation.add_argument("--run-scoped-smoke", metavar="ZERO-001")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "artifacts/agency-zero")
    parser.add_argument("--max-seconds-per-test", type=int, default=120)
    args = parser.parse_args()
    if args.generate:
        content = manifest_from_source()
        MANIFEST.write_text(json.dumps(content, indent=2) + "\n", encoding="utf-8")
        print(f"ZERO | Generated {len(content['batches'])} batches / {content['original_scenario_count']} scenarios")
        return 0
    manifest = validate_manifest(load_json(MANIFEST))
    if args.check:
        current_evidence(manifest)
        print(f"ZERO | PLAN VALID | {manifest['original_scenario_count']} scenarios / {manifest['original_brick_count']} related groups / {manifest['batch_count']} batches / <=5 cases each | APP SHA {pinned_candidate_sha()[:8]}")
        return 0
    if args.status:
        status(manifest)
        return 0
    if args.matrix:
        ids = [b["batch_id"] for b in manifest["batches"]] if args.matrix == "ALL" else [find_batch(manifest, args.matrix)["batch_id"]]
        print(json.dumps(ids, separators=(",", ":")))
        return 0
    if args.batch:
        batch = find_batch(manifest, args.batch)
        print(f"ZERO | {batch['batch_id']} | {batch['family']} | {batch['unit_count']}/5 test units")
        for unit in batch["units"]:
            kind = "MAPPED" if unit["sample_existing_case"] else "EVIDENCE_RECONCILIATION_REQUIRED"
            print(f"ZERO | {unit['scenario_id']} {unit['workflow']} | {kind}")
        return 0
    if args.run_scoped_smoke:
        if args.max_seconds_per_test < 1 or args.max_seconds_per_test > 1200:
            raise ValueError("Test timeout must be 1..1200 seconds")
        return run_scoped_smokes(manifest, args.run_scoped_smoke, args.output_dir,
                                 args.max_seconds_per_test)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f"ZERO | CONTROL ERROR: {error}", file=sys.stderr)
        sys.exit(2)
