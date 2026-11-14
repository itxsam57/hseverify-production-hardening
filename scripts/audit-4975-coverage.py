#!/usr/bin/env python3
"""Create a fail-closed *planning* register, not an attested release-test report.

The 4,975 slots are the owner's initial coverage budget: 218 frozen scenarios
x12 dimensions, 251 candidate API/server-action surfaces x8 security families,
117 UI pages x3 viewport widths. A green historical suite cannot certify a
slot until an exact-SHA protected-stage evidence attestation is supplied.
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
HISTORICAL_SOURCE = ROOT / "docs/qa/2026-10-02-evidence.json"
HISTORICAL_TSV = ROOT / "docs/qa/evidence"
DIMENSIONS = (
    "browser_controls_and_navigation",
    "responsive_keyboard_accessibility",
    "positive_workflow",
    "invalid_input_rejection",
    "retry_refresh_duplicate",
    "expiry_timeout_cancellation",
    "outage_interruption_recovery",
    "concurrency_race",
    "cross_role_notifications",
    "database_audit_history",
    "role_tenant_api_pentest",
    "genuine_provider_stage_owner_uat",
)
SECURITY_FAMILIES = (
    "unauthenticated",
    "wrong_role_privilege",
    "foreign_tenant_or_object",
    "stale_replay_token",
    "injection_and_input_abuse",
    "workflow_bypass",
    "race_retry_state",
    "privacy_and_data_exposure",
)
VIEWPORTS = ("320", "390", "1280")
HTTP_VERBS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")
METHOD_RE = re.compile(
    r"\bexport\s+(?:async\s+)?(?:function|const)\s+"
    r"(" + "|".join(HTTP_VERBS) + r")\b"
)
ACTION_FUNCTION_RE = re.compile(r"\bexport\s+(?:(?:default|async)\s+)*function\s+(\w+)")
ACTION_CONST_RE = re.compile(r"\bexport\s+const\s+(\w+)")
SERVER_MODULE_RE = re.compile(r"""['"]use server['"]""")
GREEN_BAD = ("EXPECTED_COVERAGE", "RED", "FAIL", "BLOCK", "INCOMPLETE")
COUNT_FIELDS = ("passed_tests", "pass_count", "passing_tests", "passing_cases", "pass")


def frozen_scenarios(root: Path = ROOT) -> list[dict]:
    source = json.loads((root / "docs/qa/2026-10-02-evidence.json").read_text())
    rows = source["expanded_scenario_verification"]["scenarios"]
    ids = [r["id"] for r in rows]
    bricks = {r["brick"] for r in rows}
    if len(rows) != 218 or len(set(ids)) != 218 or len(bricks) != 37:
        raise ValueError(f"Frozen scenario inventory corrupted: {len(rows)} rows, {len(set(ids))} IDs, {len(bricks)} bricks")
    return rows


def candidate_entrypoints(root: Path = ROOT) -> tuple[list[dict], dict]:
    routes = []
    route_files = sorted(p for p in (root / "src/app").rglob("route.*") if p.suffix in (".ts", ".tsx", ".js", ".mjs"))
    for p in route_files:
        rel = p.relative_to(root).as_posix()
        for method in METHOD_RE.findall(p.read_text(errors="replace")):
            routes.append({"id": "HTTP:" + method + ":" + rel, "target": rel, "method": method})
    actions = []
    for p in sorted((root / "src").rglob("*")):
        if not p.is_file() or p.suffix not in (".ts", ".tsx", ".js", ".mjs"):
            continue
        source = p.read_text(errors="replace")
        if not SERVER_MODULE_RE.search(source):
            continue
        rel = p.relative_to(root).as_posix()
        names = ACTION_FUNCTION_RE.findall(source) + ACTION_CONST_RE.findall(source)
        for name in names:
            actions.append({"id": "ACTION:" + rel + ":" + name, "target": rel, "method": name})
    all_items = routes + actions
    if len({x["id"] for x in all_items}) != len(all_items):
        raise ValueError("Duplicate candidate entrypoint ID; cannot enumerate security plan")
    return all_items, {"http_method_handlers": len(routes), "server_action_exports": len(actions), "route_files": len(route_files)}


def ui_pages(root: Path = ROOT) -> list[str]:
    return sorted(p.relative_to(root).as_posix() for p in (root / "src/app").rglob("page.tsx"))


def prior_result_rows(root: Path = ROOT) -> dict:
    results = collections.Counter()
    scenario_files = collections.defaultdict(list)
    for p in sorted((root / "docs/qa/evidence").glob("*.tsv")):
        with p.open(newline="", errors="replace") as fh:
            parsed = csv.DictReader(fh, delimiter="\t")
            for record in parsed:
                row = {str(k).lower(): str(v or "").strip() for k, v in record.items() if k is not None}
                results["total_result_rows"] += 1
                status = " ".join(row.get(k, "") for k in ("status", "result", "kind")).upper()
                count = next((int(row[k]) for k in COUNT_FIELDS if row.get(k, "").isdigit()), None)
                green = (
                    ("PASS" in status or "GREEN" in status or "OK" in status
                     or (row.get("exit_code") == "0" and count is not None and count > 0))
                    and not any(x in status for x in GREEN_BAD)
                )
                if green:
                    results["green_result_rows"] += 1
                    if count is not None:
                        results["sum_reported_passing_cases_NOT_UNIQUE"] += count
                    else:
                        results["green_rows_without_case_count"] += 1
                else:
                    results["other_result_rows"] += 1
                if "RED" in status or "FAIL" in status:
                    results["red_or_failed_rows_including_expected_tdd"] += 1
                scenario_id = row.get("scenario_id")
                if not scenario_id:
                    m = re.match(r"^M(\d+)_(\d+)_(\d+)", p.name)
                    if m:
                        scenario_id = "M" + ".".join(m.groups())
                if scenario_id:
                    scenario_files[scenario_id].append(p.name)
    results["evidence_tsv_files"] = len(list((root / "docs/qa/evidence").glob("*.tsv")))
    return {
        "numbers": dict(results),
        "files_by_scenario": {k: sorted(set(v)) for k, v in sorted(scenario_files.items())},
    }


def build_register(root: Path = ROOT, sha: str | None = None) -> tuple[dict, list[dict]]:
    rows = frozen_scenarios(root)
    actions, by_endpoint_type = candidate_entrypoints(root)
    pages = ui_pages(root)
    if sha is None:
        sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    prior = prior_result_rows(root)
    historics = collections.Counter(x["status"] for x in rows)
    result: list[dict] = []

    def append(case_id: str, category: str, target: str, test_dimension: str, scenario_id: str = "", scoped: str = "") -> None:
        result.append({
            "check_id": case_id,
            "category": category,
            "target": target,
            "check_dimension": test_dimension,
            "frozen_scenario_id": scenario_id,
            "scoped_historical_hint": scoped,
            "candidate_source_sha": sha,
            "release_certification": "NOT_CERTIFIED",
            "exact_sha_staging_attestation": "",
            "provider_approval": "",
            "owner_uat": "",
            "missing": "Final candidate real-stage, applicable multi-role browser/API/security/provider evidence and independent review",
        })

    for row in rows:
        hints = prior["files_by_scenario"].get(row["id"], [])
        for index, dimension in enumerate(DIMENSIONS, 1):
            append(
                f"SCENARIO:{row['id']}:{index:02d}",
                "scenario_dimension",
                row["scenario"],
                dimension,
                row["id"],
                f"old_status={row['status']};historical_tsv_files={len(hints)}",
            )

    for action in actions:
        for index, dimension in enumerate(SECURITY_FAMILIES, 1):
            append(f"PENTEST:{action['id']}:{index:02d}", "security_candidate",
                   action["target"] + "#" + action["method"], dimension)

    for page in pages:
        for viewport in VIEWPORTS:
            append(f"RESPONSIVE:{page}:{viewport}", "responsive_page", page, viewport + "px")

    if len({x["check_id"] for x in result}) != len(result):
        raise ValueError("Duplicate coverage check IDs")
    counts = collections.Counter(x["category"] for x in result)
    historical = dict(sorted(historics.items()))
    report = {
        "source_sha": sha,
        "source_kind": "static repository inventory plus historical result index",
        "register_version": 1,
        "frozen_scenarios": len(rows),
        "frozen_bricks": len({r["brick"] for r in rows}),
        "candidate_entrypoints": len(actions),
        "entrypoint_types": by_endpoint_type,
        "responsive_page_files": len(pages),
        "planned_checks": len(result),
        "planned_check_categories": dict(counts),
        "release_certified_checks": 0,
        "release_certified_scenarios": 0,
        "planned_checks_without_full_final_stage_attestation": len(result),
        "historical_scenario_labels": historical,
        "historical_result_index": prior["numbers"],
        "historical_scenarios_with_a_tsv": len(prior["files_by_scenario"]),
        "historical_tsv_scenario_ids": sorted(prior["files_by_scenario"]),
        "warnings": [
            "The 4975 rows are a PROVISIONAL planning matrix, not exhaustive pentest scope or runnable distinct tests.",
            "Green TSV rows are evidence-index observations from historical or scoped suites, not 4975-slot completions.",
            "Reported passing cases can overlap and repeat: never subtract their count from 4975.",
            "GitHub CI workflow success demonstrates scoped automation only; it is not exact protected-stage signoff.",
            "No independent exact-final-SHA staging, provider, complete pentest, owner UAT attestation exists here.",
            "The endpoint/action export list is a candidate attack surface; exports may not all be independently reachable.",
            "All 4975 remain uncertified by design; a future audited attestation mechanism must validate each actual case.",
        ],
        "next": "Map each slot to executable case IDs, exact release SHA+provider stage, evidence hash and approval. Confirm applicability, then rebase the planned total to the executable inventory.",
    }
    return report, result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-json", default=".autopilot/artifacts/verification-4975-coverage.json")
    parser.add_argument("--out-csv", default="docs/qa/evidence/QA_4975_PROVISIONAL_REGISTER_20261114.csv")
    args = parser.parse_args()
    report, rows = build_register()
    if len(rows) != 4975 or report["planned_check_categories"] != {
        "scenario_dimension": 2616, "security_candidate": 2008, "responsive_page": 351
    }:
        raise SystemExit(f"Planning inventory drift: {report['planned_checks']} rows; {report['planned_check_categories']}. Never fudge coverage baseline.")
    out_json = ROOT / args.out_json
    out_csv = ROOT / args.out_csv
    for path in (out_json, out_csv):
        path.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    with out_csv.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps({"report_path": str(out_json.relative_to(ROOT)),
                      "register_path": str(out_csv.relative_to(ROOT)),
                      **report}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
