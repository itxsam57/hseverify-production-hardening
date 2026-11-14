#!/usr/bin/env python3
"""Create the ONE original Masterplan 218 per-ID work-queue view.

Lists old scoped evidence and existing test identities before any new test is
started. All candidate links are review hints; no credit or release status is
derived from file names, keywords, or old commits.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
PRIOR=ROOT/"docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json"
LEGACY=ROOT/"docs/qa/evidence/MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json"
FROZEN=ROOT/"docs/qa/2026-10-02-evidence.json"
OUTPUT=ROOT/"docs/qa/evidence/MASTERPLAN_218_ALL_PREVIOUS_EVIDENCE_ACTIONS_20261114.csv"
REQUIRED=(
    "actual_browser_controls_responsive_keyboard_accessibility",
    "positive_negative_expiry_retry_interruption_race",
    "cross_role_notifications_immutable_audit_persisted_DB",
    "api_role_tenant_token_replay_privacy_abuse",
    "targeted_security_fix_retest_and_independent_full_pentest",
    "real_integrations_staging_load_restore_owner_UAT",
)
# Mirrors the existing frozen QA release blocker inventory; never assume it is exhaustive.
KNOWN_EXTERNAL={
 "M1.01.04":"Protected final staging/operations/rollback",
 "M1.03.02":"Real external email and SMS OTP delivery",
 "M3.10.01":"Real email/SMS services and outage",
 "M3.10.02":"Real payment provider acceptance and failure",
 "M3.10.03":"Real video/TURN provider",
 "M3.10.04":"Real liveness/scan/storage providers",
 "M3.10.05":"Production provider monitoring and real credentials",
 "M3.12.02":"Actual pager and operational alerts",
 "M3.12.03":"Production provider activation",
 "M3.12.04":"Protected stage backup and rollback",
}


def build() -> list[dict]:
    prior=json.loads(PRIOR.read_text())
    legacy=json.loads(LEGACY.read_text())
    frozen=json.loads(FROZEN.read_text())["expanded_scenario_verification"]["scenarios"]
    if len(frozen)!=218 or len(prior["scenarios"])!=218 or len(legacy["scenarios"])!=218:
        raise ValueError("Original 218 frozen rows not consistent")
    if len(set(x["id"] for x in frozen))!=218:
        raise ValueError("Frozen scenario identities changed")
    by_prior={x["id"]:x for x in prior["scenarios"]}
    by_legacy={x["id"]:x for x in legacy["scenarios"]}
    if len(by_prior)!=218 or len(by_legacy)!=218:raise ValueError("Duplicate scenario ID")
    results=[]
    for f in frozen:
        sid=f["id"]
        p=by_prior[sid]
        old=by_legacy[sid]
        if old["legacy_a28_reconciliation_result"]!="NOT_CERTIFIED":
            raise ValueError(f"Old claim became release PASS: {sid}")
        green=p["green_exact_reference_CI_cases_linked"]+p["green_history_only_cases_linked"]
        candidate_ids=old["candidate_case_ids_from_old_logs_NOT_COVERAGE_CERTIFICATION"]
        mixed=sum(x["log_evidence_status"]=="MIXED_OR_NO_CLEAN_SUMMARY" for x in old["old_scoped_evidence"])
        clean=len(old["old_scoped_evidence"])-mixed
        if mixed:
            next_step="REVIEW_MIXED_OLD_LOG_BEFORE_REUSE"
        elif green:
            next_step="REUSE_DIRECT_GREEN_CASES_VERIFY_REMAINING_ACCEPTANCE"
        elif candidate_ids:
            next_step="REVIEW_OLD_LOG_MATCHED_CASES_NOT_AUTO_CREDITED"
        elif old["old_scoped_evidence"]:
            next_step="REVIEW_OLD_SCOPED_CLAUSE_LOG_WITH_NO_CURRENT_MATCH"
        elif sid=="M1.01.03":
            next_step="REUSE_EXACT_QA_CI_AND_COMPLETE_DEPLOYMENT_STAGE_ASSERTIONS"
        elif sid in KNOWN_EXTERNAL:
            next_step="BLOCKED_EXTERNAL_PREPARE_ISOLATED_STAGE_WITHOUT_NEW_TESTS"
        else:
            next_step="CHECK_SHARED_CASES_THEN_BUILD_MISSING_ACCEPTANCE_TESTS"
        results.append({
            "frozen_id":sid,
            "brick":f["brick"],
            "family":f["family"],
            "required_roles":"; ".join(f["roles"]),
            "scenario":f["scenario"],
            "historical_2026_10_status_not_release":f["status"],
            "legacy_A28_scoped_observation_exists":str(old["previous_216_scoped_observation_present"]).upper(),
            "legacy_A28_browser_observations":old["browser_legacy_observations"],
            "legacy_A28_native_observations":old["native_legacy_observations"],
            "legacy_A28_local_observations":old["local_legacy_observations"],
            "legacy_clean_old_log_references_not_full_pass":clean,
            "legacy_mixed_or_uncertain_references":mixed,
            "prior_direct_named_source_cases":p["existing_source_cases_linked"],
            "prior_direct_CI_green_case_links_reference_sha":p["green_exact_reference_CI_cases_linked"],
            "prior_direct_older_green_case_links":p["green_history_only_cases_linked"],
            "old_log_source_name_case_candidates_not_credited":len(candidate_ids),
            "old_scoped_log_evidence_ids":"; ".join(x["observation_id"] for x in old["old_scoped_evidence"]),
            "direct_green_case_ids":"; ".join(p["linked_case_ids"]),
            "old_named_case_candidate_ids_unreviewed":"; ".join(candidate_ids),
            "known_external_blocker_or_blank":KNOWN_EXTERNAL.get(sid,""),
            "six_required_full_acceptance_dimensions_unverified":"; ".join(REQUIRED),
            "recommended_next_action":next_step,
            "full_release_scenario_status":"NOT_FULLY_VERIFIED",
        })
    assert len(results)==218
    assert sum(x["legacy_A28_scoped_observation_exists"]=="TRUE" for x in results)==216
    assert sum(x["legacy_clean_old_log_references_not_full_pass"] for x in results)==307
    assert sum(x["legacy_mixed_or_uncertain_references"] for x in results)==9
    assert len(KNOWN_EXTERNAL)==10
    return results


def main() -> None:
    p=argparse.ArgumentParser()
    p.add_argument("--verify",action="store_true")
    args=p.parse_args()
    rows=build()
    if args.verify:
        with OUTPUT.open(newline="") as fp:
            archived=list(csv.DictReader(fp))
        expected=[{k:str(v) for k,v in x.items()} for x in rows]
        if archived!=expected:
            raise ValueError("218 row baseline action map drift; regenerate and review")
        print(json.dumps({"verified":218,"legacy_observed":216,"old_clean_refs":307,"mixed_old_refs":9,
                          "full_release_certified":0},sort_keys=True))
        return
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    with OUTPUT.open("w",newline="") as fp:
        writer=csv.DictWriter(fp,fieldnames=list(rows[0]),lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps({
        "frozen_rows":len(rows),
        "old_scoped_ids":sum(x["legacy_A28_scoped_observation_exists"]=="TRUE" for x in rows),
        "old_clean_refs":sum(x["legacy_clean_old_log_references_not_full_pass"] for x in rows),
        "old_mixed_refs":sum(x["legacy_mixed_or_uncertain_references"] for x in rows),
        "with_direct_green_cases":sum(x["prior_direct_CI_green_case_links_reference_sha"]+x["prior_direct_older_green_case_links"]>0 for x in rows),
        "with_old_log_case_candidates":sum(x["old_log_source_name_case_candidates_not_credited"]>0 for x in rows),
        "release_scenarios_certified":0,
        "summary_by_next_action":{
            name:sum(x["recommended_next_action"]==name for x in rows)
            for name in sorted({x["recommended_next_action"] for x in rows})
        }
    },indent=2))


if __name__=="__main__":
    main()
