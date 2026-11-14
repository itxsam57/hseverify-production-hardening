#!/usr/bin/env python3
"""Preserve the old '216/218 with scoped evidence' checkpoint in ONE 218 ledger.

The A28 source is an immutable old-commit observation map, not full scenario
certification. For each claim we independently check the named raw old log,
record its digest and step-level pass marker, and find uniquely identifiable
current source test titles. No current stage test is run by this script.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
OLD_SNAPSHOT = ROOT / "docs/qa/evidence/LEGACY_A28_SCOPED_218_CHECKPOINT_20261106.json"
CURRENT_CASE_INDEX = ROOT / "docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json"
RESULT = ROOT / "docs/qa/evidence/MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json"
A28_SOURCE_DIGEST = "85947e060449b1a6ea51d1937903a23c42df7f80ab5e654b9fd6aaae4fbb32b5"
A28_SOURCE_GIT_SHA = "eb77b70f6584c76169e7d6b849b88e25ae666696"
SPEC_CASE = re.compile(r"✔\s+(.*?)\s+\(([\d.]+)ms\)")
CLEAN_PASS = re.compile(r"ℹ fail 0\b")
ANY_FAILURE = re.compile(r"ℹ fail [1-9]\d*\b|(?:^|\n)\s*✖\s+|(?:^|\n)\s*not ok\s+\d+",re.I)


def load_sources() -> tuple[dict, dict, list[dict]]:
    original = OLD_SNAPSHOT.read_bytes()
    if hashlib.sha256(original).hexdigest() != A28_SOURCE_DIGEST:
        raise ValueError("Legacy original source snapshot changed; no scenario credit")
    old = json.loads(original)
    if old["current_head_sha"] != A28_SOURCE_GIT_SHA or old["frozen_scenarios"] != 218 or old["frozen_bricks"] != 37:
        raise ValueError("Old A28 source identity changed")
    prior = json.loads(CURRENT_CASE_INDEX.read_text())
    frozen = json.loads((ROOT/"docs/qa/2026-10-02-evidence.json").read_text())["expanded_scenario_verification"]["scenarios"]
    if not (len(frozen) == len(old["scenarios"]) == len(prior["scenarios"]) == 218):
        raise ValueError("Frozen scenario row count mismatch")
    if len({r["id"] for r in frozen}) != 218:
        raise ValueError("Frozen IDs not unique")
    same = ("id", "brick", "scenario", "roles")
    for f, o in zip(frozen, old["scenarios"]):
        if any(f[k] != o[k] for k in same):
            raise ValueError(f"A28 legacy frozen scenario changed: {f['id']}")
    return old, prior, frozen


def evidence_records(old: dict, prior: dict, legacy_worktree: Path) -> dict:
    case_by_title = collections.defaultdict(list)
    case_by_id = {}
    for c in prior["cases"]:
        case_by_title[c["title"]].append(c)
        case_by_id[c["case_id"]] = c
    counts = collections.Counter()
    all_cases = set()
    mapped_pairs = set()
    old_unmatched_titles = collections.defaultdict(set)
    rows = []
    old_relative_log_cache = {}
    for x in old["scenarios"]:
        refs = []
        types = [
            ("BROWSER", x["scoped_exact_browser_observations"]),
            ("NATIVE", x["scoped_exact_native_observations"]),
            ("LOCAL", [x["scoped_local_evidence"]] if isinstance(x.get("scoped_local_evidence"), dict) else []),
        ]
        for kind, arr in types:
            for obj in arr:
                rel = obj.get("log")
                if not isinstance(rel, str) or not rel.startswith(".autopilot/artifacts/") or ".." in Path(rel).parts:
                    raise ValueError("Unsafe or missing old A28 log pointer")
                if rel not in old_relative_log_cache:
                    p = legacy_worktree/rel
                    if not p.is_file():
                        raise FileNotFoundError(f"Missing original historical log; do not invent proof: {rel}")
                    raw = p.read_bytes()
                    text = raw.decode("utf-8",errors="replace")
                    titles = sorted({m[0].strip() for m in SPEC_CASE.findall(text)})
                    clean = bool(CLEAN_PASS.search(text) and not ANY_FAILURE.search(text))
                    old_relative_log_cache[rel] = {
                        "sha256": hashlib.sha256(raw).hexdigest(),
                        "total_bytes": len(raw),
                        "all_passing_title_names": titles,
                        "execution_summary": "CLEAN_OLD_TEST_LOG" if clean else "MIXED_OR_NO_CLEAN_SUMMARY",
                    }
                log = old_relative_log_cache[rel]
                case_refs = sorted({
                    case_by_title[t][0]["case_id"]
                    for t in log["all_passing_title_names"]
                    if len(case_by_title[t]) == 1
                    and case_by_title[t][0]["test_execution"] != "NO_PASS_LOG_EVIDENCE"
                })
                for title in log["all_passing_title_names"]:
                    if len(case_by_title[title]) != 1:
                        old_unmatched_titles[title].add(x["id"])
                source_sha = obj.get("observed_code_sha") or old["current_head_sha"]
                if not re.fullmatch(r"[a-f0-9]{40}", source_sha):
                    raise ValueError("A28 reference missing old source Git SHA")
                if obj.get("code_head_matches_observation") is True:
                    raise ValueError("An old observation cannot be asserted to match exact A28 reconciliation source")
                kind_key = kind.lower()
                counts[f"{kind_key}_references"] += 1
                counts["total_scoped_observation_references"] += 1
                if log["execution_summary"] == "CLEAN_OLD_TEST_LOG":
                    counts["old_log_references_with_clean_green_run_summary"] += 1
                    if case_refs:
                        counts["old_log_references_with_unique_current_test_title_matches"] += 1
                else:
                    counts["old_log_references_mixed_or_missing_clean_run_summary"] += 1
                for case_id in case_refs:
                    if log["execution_summary"] == "CLEAN_OLD_TEST_LOG":
                        all_cases.add(case_id)
                        mapped_pairs.add((x["id"],case_id))
                claim = str(obj.get("proven_clause_only") or obj.get("remaining") or obj.get("disposition") or "")
                if not claim:
                    raise ValueError(f"Missing contextual old clause for {x['id']} {kind}")
                identity = "|".join([x["id"],kind,source_sha,rel,claim])
                refs.append({
                    "observation_id": hashlib.sha256(identity.encode()).hexdigest()[:24],
                    "kind": kind,
                    "legacy_source_sha": source_sha,
                    "legacy_log_path_in_existing_worktree": f"{legacy_worktree.name}/{rel}",
                    "legacy_log_sha256": log["sha256"],
                    "legacy_log_bytes": log["total_bytes"],
                    "log_evidence_status": log["execution_summary"],
                    "old_scoped_clause": claim,
                    "candidate_current_source_case_ids_FROM_SHARED_OLD_LOG_NOT_AUTOMATIC_SCENARIO_PASS": case_refs,
                })
        ids = {r["observation_id"] for r in refs}
        if len(ids) != len(refs):
            raise ValueError(f"Repeated old reference ID within {x['id']}")
        has = bool(refs)
        if has: counts["scenarios_with_any_historical_scoped_observation"] += 1
        if any(v["log_evidence_status"] == "CLEAN_OLD_TEST_LOG" for v in refs):
            counts["scenarios_with_at_least_one_old_clean_green_log_reference"] += 1
        if any(v["candidate_current_source_case_ids_FROM_SHARED_OLD_LOG_NOT_AUTOMATIC_SCENARIO_PASS"] for v in refs):
            counts["scenarios_with_current_test_name_matches_in_old_logs"] += 1
        rows.append({
            "id": x["id"], "historical_status_older_sha": x["historical_status_older_sha"],
            "legacy_a28_reconciliation_result": x["current_result"],
            "previous_216_scoped_observation_present": has,
            "browser_legacy_observations": sum(v["kind"] == "BROWSER" for v in refs),
            "native_legacy_observations": sum(v["kind"] == "NATIVE" for v in refs),
            "local_legacy_observations": sum(v["kind"] == "LOCAL" for v in refs),
            "old_scoped_evidence": refs,
            "candidate_case_ids_from_old_logs_NOT_COVERAGE_CERTIFICATION": sorted({
                case_id for ref in refs if ref["log_evidence_status"]=="CLEAN_OLD_TEST_LOG"
                for case_id in ref["candidate_current_source_case_ids_FROM_SHARED_OLD_LOG_NOT_AUTOMATIC_SCENARIO_PASS"]
            }),
            "final_stage_release_verification": "NOT_FULLY_VERIFIED",
        })
    counts["unique_old_log_case_titles_unmatched_to_current_source"] = len(old_unmatched_titles)
    counts["scenario_title_unmatched_review_links"] = sum(len(v) for v in old_unmatched_titles.values())
    counts["unique_old_legacy_log_files_read"] = len(old_relative_log_cache)
    counts["source_cases_matching_at_least_one_old_historical_clause"] = len(all_cases)
    counts["scenario_to_source_case_candidate_links_from_old_logs"] = len(mapped_pairs)
    counts["historical_claimed_scenarios_without_any_observation"] = 218-counts["scenarios_with_any_historical_scoped_observation"]
    if (counts["scenarios_with_any_historical_scoped_observation"],counts["total_scoped_observation_references"],
        counts["old_log_references_with_clean_green_run_summary"],
        counts["historical_claimed_scenarios_without_any_observation"]) != (216,316,307,2):
        raise ValueError(f"Unexpected old evidence totals {dict(counts)}; do not silently adjust historical claims")
    return {
        "report_type":"LEGACY_A28_HISTORICAL_SCOPED_EVIDENCE_NOT_RELEASE_CERTIFICATION",
        "historical_a28_source_sha": A28_SOURCE_GIT_SHA,
        "original_a28_snapshot_sha256": A28_SOURCE_DIGEST,
        "prior_distinct_test_index_sha256": hashlib.sha256(CURRENT_CASE_INDEX.read_bytes()).hexdigest(),
        "frozen_scenarios":218,
        "historical_source_status":"OLD_COMMIT_ALL_SCOPED_ONLY",
        "counts":dict(sorted(counts.items())),
        "scenarios":rows,
        "legacy_old_test_titles_without_current_exact_source_match_for_manual_review": [
            {
                "title_sha256":hashlib.sha256(name.encode()).hexdigest(),
                "redacted_title_preview":re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}","[redacted-email]",name),
                "scenario_ids_historically_claiming_scope":sorted(ids),
                "is_current_source_test_case":False,
                "is_release_pass":False,
            }
            for name, ids in sorted(old_unmatched_titles.items())
        ],
        "notes":[
            "Old 216/218 means some scoped clauses on old commits, not 216 fully verified or 216 whole workflows.",
            "Old clean-log markers establish test log execution summaries only; a matching test title in the same log does not necessarily validate the claimed scenario clause.",
            "Nine mixed or missing-clean-summary old log references from three source log files are NOT unambiguous successes; keep for manual review.",
            "Matching current test case IDs are triage candidates, not automatically credited per-scenario test completions.",
            "Raw old logs remain in authorized old worktree, hashed and referenced; no provider or final exact-SHA protected stage proof exists.",
            "This index is incorporated into the SAME original 218-row release ledger, no new competing certification count.",
        ],
    }


def verify_index() -> dict:
    old, previous, frozen = load_sources()
    result = json.loads(RESULT.read_text())
    if result["original_a28_snapshot_sha256"] != A28_SOURCE_DIGEST:
        raise ValueError("Old source checksum altered")
    if result["prior_distinct_test_index_sha256"] != hashlib.sha256(CURRENT_CASE_INDEX.read_bytes()).hexdigest():
        raise ValueError("Current prior-case index changed; rebuild old log-title associations")
    if result["counts"]["unique_old_log_case_titles_unmatched_to_current_source"] != 55:
        raise ValueError("Unmatched older test titles missing from historical manual review index")
    rows = result["scenarios"]
    if len(rows) != 218 or [x["id"] for x in rows] != [x["id"] for x in frozen]:
        raise ValueError("Legacy 216 ID set not frozen 218")
    all_refs=[e for r in rows for e in r["old_scoped_evidence"]]
    refs_216=sum(bool(r["old_scoped_evidence"]) for r in rows)
    clean=sum(e["log_evidence_status"]=="CLEAN_OLD_TEST_LOG" for e in all_refs)
    if (len(all_refs),refs_216,clean)!=(316,216,307):
        raise ValueError("Legacy historical 316 refs/216 scenarios/307 unambiguously clean marker drift")
    all_ids={c["case_id"] for c in previous["cases"]}
    for r in rows:
        if r["final_stage_release_verification"]!="NOT_FULLY_VERIFIED":
            raise ValueError("Legacy evidence cannot grant final verification")
        for e in r["old_scoped_evidence"]:
            if not re.fullmatch(r"[a-f0-9]{64}",e["legacy_log_sha256"]):
                raise ValueError("Historic log hash invalid")
            if not set(e["candidate_current_source_case_ids_FROM_SHARED_OLD_LOG_NOT_AUTOMATIC_SCENARIO_PASS"])<=all_ids:
                raise ValueError("Unknown old log matched source case")
    return {"old_scoped_scenarios":refs_216,"old_log_refs":len(all_refs),"clean_refs":clean,
            "missing_old_scoped_scenarios":[r["id"] for r in rows if not r["old_scoped_evidence"]],
            "fully_certified_from_old":0}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--legacy-worktree",default="/home/ubuntu/work/hseverify-masterplan-release")
    parser.add_argument("--verify-index",action="store_true")
    args=parser.parse_args()
    if args.verify_index:
        print(json.dumps(verify_index(),indent=2));return
    old,prior,frozen=load_sources()
    result=evidence_records(old,prior,Path(args.legacy_worktree))
    RESULT.write_text(json.dumps(result,indent=2,ensure_ascii=False,sort_keys=True)+"\n")
    print(json.dumps(result["counts"],indent=2,sort_keys=True))
    print(json.dumps(verify_index(),indent=2))


if __name__=="__main__":
    main()
