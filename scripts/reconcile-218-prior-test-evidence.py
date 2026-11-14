#!/usr/bin/env python3
"""Reuse prior Node/browser test executions inside the frozen 218 Masterplan ledger.

This is an evidence index, NOT a claim of fully verified scenario, complete
pentest or protected-stage acceptance. Strong case identity = source path +
literal test title. Repeated historical runs count ONCE. Never infer a PASS
from source existence, a green unrelated job, a red/partial log, or a TSV count.
"""
from __future__ import annotations
import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
CASE_DECL = re.compile(r'''(?m)^\s*test\s*\(\s*(["'\x60])(.+?)\1''')
PASS_SPEC = re.compile(r"✔\s+(.*?)\s+\(([\d.]+)ms\)")
FAIL_SPEC = re.compile(r"(?:ℹ fail [1-9]\d*\b|(?:^|\n)\s*✖\s+|(?:^|\n)\s*not ok\s+\d+)", re.I)
GOOD_SUMMARY = re.compile(r"ℹ fail 0\b")
TEST_PATH = re.compile(r"tests/[\w\-./()[\]]+?\.test\.mjs")
SCENARIO_DOT = re.compile(r"\bM[123]\.\d{2}\.\d{2}\b")
SCENARIO_COMPACT = re.compile(r"(?<!\w)M([123])[_-]?(\d{2})[_-]?(\d{2})(?!\d)", re.I)
PEN_KEYWORDS = re.compile(r"(?i)\b(bola|idor|csrf|ssrf|xss|injection|cross[- ](?:tenant|account|role)|unauthori[sz]ed|forged|replay|stale|permission|escalat|abuse|leak|malware|quarantine|deny|denied|private|isolation)\b")


def frozen_rows(root: Path) -> list[dict]:
    j = json.loads((root / "docs/qa/2026-10-02-evidence.json").read_text())
    rows = j["expanded_scenario_verification"]["scenarios"]
    assert len(rows) == 218 and len({r["id"] for r in rows}) == 218 and len({r["brick"] for r in rows}) == 37
    return rows


def scenario_tags(text: str, ids: set[str]) -> set[str]:
    raw = set(SCENARIO_DOT.findall(text))
    raw |= {f"M{a}.{b}.{c}" for a, b, c in SCENARIO_COMPACT.findall(text)}
    return raw & ids


def source_catalog(root: Path, frozen_ids: set[str]) -> tuple[list[dict], dict[str, set[str]]]:
    rows: list[dict] = []
    titles: dict[str, set[str]] = collections.defaultdict(set)
    for path in sorted((root / "tests").rglob("*.test.mjs")):
        rel = path.relative_to(root).as_posix()
        src = path.read_text(errors="replace")
        parsed = CASE_DECL.findall(src)
        for _, name in parsed:
            if "\n" in name or not name.strip():
                continue
            if name in titles and rel in titles[name]:
                continue
            titles[name].add(rel)
            direct = sorted(scenario_tags(name, frozen_ids) | scenario_tags(rel, frozen_ids))
            rows.append({"file": rel, "title": name, "direct_scenarios": direct,
                         "case_id": rel + "#" + hashlib.sha256(name.encode()).hexdigest()[:16]})
    return rows, titles


def linked_files(root: Path, frozen_ids: set[str]) -> dict[str, set[str]]:
    """Report/TSV references are hints, not indisputable case-level links."""
    file_ids: dict[str, set[str]] = collections.defaultdict(set)
    evidence = root / "docs/qa/evidence"
    reports = root / "docs/qa"
    files = list(evidence.glob("*.tsv")) + list(reports.glob("M*.md"))
    for path in files:
        scenarios = scenario_tags(path.name, frozen_ids)
        if not scenarios:
            continue
        try:
            text = path.read_text(errors="replace")
        except Exception:
            continue
        paths = TEST_PATH.findall(text)
        for f in paths:
            # Preserve only paths that actually exist in this source snapshot.
            if (root / f).is_file():
                file_ids[f].update(scenarios)
    return file_ids


def historical_worktree_logs(root: Path) -> tuple[list[Path], int]:
    cp = subprocess.run(["git", "worktree", "list", "--porcelain"], cwd=root,
                        text=True, capture_output=True, timeout=25)
    if cp.returncode:
        raise RuntimeError("Unable to enumerate historical worktrees")
    trees = [Path(line[9:]) for line in cp.stdout.splitlines() if line.startswith("worktree ")]
    # Exclude our uncommitted audit worktree: its own audit/regression logs are
    # newly created, not historical passing work that the owner wants reused.
    logs = [f for tree in trees if tree.resolve() != root.resolve()
            for f in (tree / ".autopilot/artifacts").glob("*.log") if f.is_file()]
    return logs, len(trees)


def extract_historical(catalog: dict[str, set[str]], logs: list[Path]) -> tuple[dict, dict]:
    hits: dict[tuple[str, str], dict] = {}
    counts = collections.Counter()
    unmatched = collections.Counter()
    for p in logs:
        counts["historical_log_files_scanned"] += 1
        text = p.read_text(errors="replace")
        matches = PASS_SPEC.findall(text)
        if not matches:
            continue
        counts["logs_with_pass_lines"] += 1
        if not GOOD_SUMMARY.search(text) or FAIL_SPEC.search(text):
            counts["logs_with_no_clean_pass_summary_or_a_failure"] += 1
            continue
        counts["clean_pass_summary_logs"] += 1
        for title, _duration in matches:
            title = title.strip()
            matches_in_catalog = catalog.get(title, set())
            if len(matches_in_catalog) != 1:
                unmatched[title] += 1
                continue
            path = next(iter(matches_in_catalog))
            key = (path, title)
            row = hits.setdefault(key, {"count_repeated_runs": 0, "proofs": []})
            row["count_repeated_runs"] += 1
            if len(row["proofs"]) < 3:
                row["proofs"].append({
                    "source_log": p.parent.parent.parent.name + "/.autopilot/artifacts/" + p.name,
                    "sha256": hashlib.sha256(text.encode()).hexdigest(),
                    "status": "clean_green_summary_historical_worktree",
                    "tested_commit_sha": "UNKNOWN_FROM_LOG_NOT_RELEASE_ATTESTATION",
                })
    counts["unique_source_matched_historical_green_cases"] = len(hits)
    counts["matched_case_occurrences_with_duplicates"] = sum(x["count_repeated_runs"] for x in hits.values())
    counts["ambiguous_or_changed_title_occurrences"] = sum(unmatched.values())
    counts["ambiguous_or_changed_unique_titles"] = len(unmatched)
    return hits, dict(counts)


def current_ci_matches(catalog: dict[str, set[str]], ci: dict) -> tuple[dict, dict]:
    hits: dict[tuple[str, str], dict] = {}
    counts = collections.Counter()
    seen_raw = set()
    unmatch = {}
    for run in ci["runs"]:
        if run["log_read"] != "OK":
            counts["ci_runs_without_logs"] += 1
            continue
        for row in run["observed"]:
            name = row["case_name"]
            counts["case_pass_occurrences"] += 1
            seen_raw.add(name)
            candidates = catalog.get(name, set())
            if len(candidates) != 1:
                unmatch[name] = len(candidates)
                continue
            path = next(iter(candidates))
            key = (path, name)
            out = hits.setdefault(key, {"run_ids": set(), "proofs": []})
            out["run_ids"].add(run["run_id"])
            if len(out["proofs"]) < 3:
                out["proofs"].append({
                    "run_id": run["run_id"],
                    "workflow": run["name"],
                    "job": row["job"],
                    "step": row["step"],
                    "run_log_sha256": run["digest_sha256"],
                    "tested_commit_sha": ci["source_sha"],
                    "status": "exact_CI_SHA_green_test_and_run",
                })
    counts["distinct_observed_names_any_source"] = len(seen_raw)
    counts["matched_unique_exact_CI_SHA_green_cases"] = len(hits)
    counts["unmatched_or_ambiguous_distinct_CI_names"] = len(unmatch)
    counts["matched_duplicate_case_occurrences"] = sum(len(x["run_ids"]) for x in hits.values()) - len(hits)
    return hits, dict(counts)


def build(root: Path, ci: dict, scan_historical: bool = True) -> dict:
    frozen = frozen_rows(root)
    ids = {x["id"] for x in frozen}
    catalog_rows, title_map = source_catalog(root, ids)
    hints = linked_files(root, ids)
    logs, trees = historical_worktree_logs(root) if scan_historical else ([], 0)
    old, past_counts = extract_historical(title_map, logs)
    exact, ci_counts = current_ci_matches(title_map, ci)
    by_scenario = collections.defaultdict(list)
    cases = []
    summed = collections.Counter()
    for case in catalog_rows:
        key = case["file"], case["title"]
        history = old.get(key, {})
        current = exact.get(key, {})
        state = "EXACT_CI_SHA_PASSED" if current else ("HISTORICAL_LOG_PASSED" if history else "NO_PASS_LOG_EVIDENCE")
        association = case["direct_scenarios"]
        method = "explicit_case_or_filename" if association else "unmapped"
        if not association:
            candidates = hints.get(case["file"], set())
            if len(candidates) == 1:
                association = sorted(candidates)
                method = "single_scenario_historical_report_link"
            elif len(candidates) > 1:
                method = "ambiguous_multiple_report_links"
        expanded = {
            **case, "scenario_ids": association, "scenario_link_kind": method,
            "test_execution": state,
            "exact_ci_pass_count_runs": len(current.get("run_ids", [])),
            "prior_log_pass_repetition_count": history.get("count_repeated_runs", 0),
            "evidence": current.get("proofs", []) + history.get("proofs", []),
            "is_security_related_title": bool(PEN_KEYWORDS.search(case["title"])),
        }
        cases.append(expanded)
        summed[state] += 1
        if association:
            summed["with_scenario_link"] += 1
        elif state != "NO_PASS_LOG_EVIDENCE":
            summed["passed_cases_need_scenario_mapping"] += 1
        if expanded["is_security_related_title"] and state != "NO_PASS_LOG_EVIDENCE":
            summed["security_flavored_test_cases_previously_green"] += 1
        for sid in association:
            by_scenario[sid].append(expanded)
    if len({x["case_id"] for x in cases}) != len(cases):
        raise ValueError("Case ID collision, stop")
    scenario_progress = []
    for x in frozen:
        assoc = by_scenario[x["id"]]
        scenario_progress.append({
            "id": x["id"], "brick": x["brick"], "family": x["family"], "scenario": x["scenario"],
            "existing_source_cases_linked": len(assoc),
            "green_exact_reference_CI_cases_linked": sum(c["test_execution"]=="EXACT_CI_SHA_PASSED" for c in assoc),
            "green_history_only_cases_linked": sum(c["test_execution"]=="HISTORICAL_LOG_PASSED" for c in assoc),
            "linked_case_ids": [c["case_id"] for c in assoc if c["test_execution"]!="NO_PASS_LOG_EVIDENCE"][:100],
            "full_scenario_verification": "NOT_FULLY_VERIFIED",
        })
    if len(scenario_progress) != 218:
        raise ValueError("218 rows lost")
    source_files = sorted((root / "tests").rglob("*.test.mjs"))
    source_digest = hashlib.sha256()
    for fp in source_files:
        source_digest.update(fp.relative_to(root).as_posix().encode() + b"\0")
        source_digest.update(hashlib.sha256(fp.read_bytes()).digest())
    counts = {
        "current_test_source_content_sha256": source_digest.hexdigest(),
        "current_source_test_files": len(list((root / "tests").rglob("*.test.mjs"))),
        "static_existing_distinct_test_cases": len(cases),
        "previous_green_distinct_source_matched_cases": summed["EXACT_CI_SHA_PASSED"] + summed["HISTORICAL_LOG_PASSED"],
        "source_tests_without_green_execution_proof": summed["NO_PASS_LOG_EVIDENCE"],
        "current_reference_CI_green_distinct_cases": summed["EXACT_CI_SHA_PASSED"],
        "historical_only_green_distinct_cases": summed["HISTORICAL_LOG_PASSED"],
        "previous_green_security_titled_cases_NOT_PENTEST_COVERAGE": summed["security_flavored_test_cases_previously_green"],
        "existing_source_cases_linked_to_an_exact_218_id": summed["with_scenario_link"],
        "passed_cases_needing_scenario_mapping": summed["passed_cases_need_scenario_mapping"],
        "frozen_ids_with_at_least_one_sourced_green_case": sum(bool(r["green_exact_reference_CI_cases_linked"]+r["green_history_only_cases_linked"]) for r in scenario_progress),
        "frozen_full_release_verified": 0,
        "worktrees_scanned": trees,
        "previous_QA_CI_successful_workflows": ci["github_workflows_successful"],
        "previous_QA_CI_workflows_with_logs_read": ci["github_workflows_log_read"],
        "prior_result_TSV_files": len(list((root / "docs/qa/evidence").glob("*.tsv"))),
        **past_counts,
        "exact_ci": ci_counts,
    }
    assert counts["previous_green_distinct_source_matched_cases"] + counts["source_tests_without_green_execution_proof"] == len(cases)
    return {
        "report_version": 1, "original_goal": "All 218 frozen Masterplan scenarios FULLY_VERIFIED and full independent pentest",
        "frozen_scenarios": 218,
        "inventory_started_from_git_head_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
        "last_scoped_CI_reference_sha": ci["source_sha"],
        "counts": counts, "scenarios": scenario_progress, "cases": cases,
        "disclaimers": [
            "Source test title plus file path is the dedupe identity, regardless of repeated logs and CI workflows.",
            "Only passing raw test-name observations from clean historical run summaries and successful exact-reference-SHA GitHub CI are credited as previously executed.",
            "Historical log provenance is an old worktree artifact, NOT proof the same test passed on final release SHA.",
            "The previous referenced CI SHA may become historical when a new audit-only merge SHA is produced.",
            "Tests with dynamic titles, moved code, missing logs or ambiguous source matches are uncounted and require further evidence mapping.",
            "Unexecuted source test definitions are NOT passes. Pen-test completeness, real providers, responsive UI and owner UAT are NOT established by existing unit/browser case passes.",
            "Explicit per-scenario test links are conservative; unmatched green tests count globally once but are not credited to an arbitrary 218 ID.",
            "0/218 fully verified is preserved. Future final stage certification requires separate exact-SHA evidence for every applicable acceptance criterion.",
        ],
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--verify-index", action="store_true", help="Offline fail-closed verification; never rewrite report")
    p.add_argument("--lookup-scenario", help="Read-only existing-test lookup by frozen M1.02.03 ID; suggestions are never auto-credited")

    p.add_argument("--ci-evidence", default=".autopilot/artifacts/QA_PRIOR_EXACT_CI_PASSES.json")
    p.add_argument("--out-json", default="docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json")
    p.add_argument("--out-csv", default="docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS_BY_SCENARIO.csv")
    args = p.parse_args()
    if args.lookup_scenario:
        archived = json.loads((ROOT / args.out_json).read_text())
        scenario = next((x for x in archived["scenarios"] if x["id"] == args.lookup_scenario), None)
        if scenario is None:
            raise ValueError("Unknown frozen Masterplan scenario")
        direct = [x for x in archived["cases"] if scenario["id"] in x["scenario_ids"]]
        stop = {"and", "the", "for", "with", "from", "this", "that", "should",
                "worker", "company", "system", "admin", "assessor", "verifier", "role",
                "case", "test", "tests", "user", "all", "into", "each", "other",
                "runtime", "isolation", "security", "current", "source", "live"}
        def words(s):
            return {w for w in re.findall(r"[a-z]{4,}", s.lower()) if w not in stop}
        goal_words = words(scenario["scenario"] + " " + scenario["family"])
        candidates = []
        for row in archived["cases"]:
            if scenario["id"] in row["scenario_ids"]:
                continue
            title_words = words(row["title"])
            path_words = words(row["file"].replace("-", " ").replace("_", " "))
            weight = 3 * len(goal_words & title_words) + len(goal_words & path_words)
            if weight > 0:
                candidates.append((weight, row))
        candidates.sort(key=lambda z: (-z[0], z[1]["case_id"]))
        print(json.dumps({
            "original_frozen_scenario": scenario["id"],
            "scenario": scenario["scenario"],
            "already_linked_prior_tests": [
                {"case_id": x["case_id"], "title": x["title"], "execution": x["test_execution"]}
                for x in direct
            ],
            "search_candidates_NOT_SCENARIO_CREDIT": [
                {"match_score_for_triage_only": score, "case_id": x["case_id"],
                 "title": x["title"], "execution": x["test_execution"]}
                for score, x in candidates[:8]
            ],
            "disclaimer": "Read source, real logs and test inputs before applying an exact 218 scenario ID; candidate suggestions never count automatically."
        }, indent=2, ensure_ascii=False))
        return
    if args.verify_index:
        archived = json.loads((ROOT / args.out_json).read_text())
        rows = frozen_rows(ROOT)
        catalog, _ = source_catalog(ROOT, {r["id"] for r in rows})
        files = sorted((ROOT / "tests").rglob("*.test.mjs"))
        digest = hashlib.sha256()
        for path in files:
            digest.update(path.relative_to(ROOT).as_posix().encode() + b"\0")
            digest.update(hashlib.sha256(path.read_bytes()).digest())
        c = archived["counts"]
        assert archived["frozen_scenarios"] == 218 and len(archived["scenarios"]) == 218
        assert len(archived["cases"]) == c["static_existing_distinct_test_cases"] == len(catalog)
        assert digest.hexdigest() == c["current_test_source_content_sha256"], "Test source changed: regenerate unique-case evidence without rewriting historical passes"
        assert c["previous_green_distinct_source_matched_cases"] + c["source_tests_without_green_execution_proof"] == len(catalog)
        assert c["previous_green_distinct_source_matched_cases"] == c["current_reference_CI_green_distinct_cases"] + c["historical_only_green_distinct_cases"]
        assert c["frozen_full_release_verified"] == 0
        print(json.dumps({"index":"verified", "distinct_source_cases":len(catalog),
                          "previous_green":c["previous_green_distinct_source_matched_cases"],
                          "full_verified":0},sort_keys=True))
        return
    ci = json.loads((ROOT / args.ci_evidence).read_text())
    if ci["github_workflows_successful"] != 29 or ci["github_workflows_log_read"] != 29:
        raise ValueError("Exact baseline CI snapshot incomplete; no substituted passing jobs")
    result = build(ROOT, ci)
    out = ROOT / args.out_json
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    table = ROOT / args.out_csv
    with table.open("w", newline="") as fp:
        headers = [k for k in result["scenarios"][0] if k != "linked_case_ids"]
        writer = csv.DictWriter(fp, fieldnames=headers, lineterminator="\n")
        writer.writeheader()
        writer.writerows({k: s[k] for k in headers} for s in result["scenarios"])
    print(json.dumps(result["counts"], sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
