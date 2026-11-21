#!/usr/bin/env python3
"""Read-only exact-SHA CI execution evidence extractor.

This indexes *observed passed test names*. It does not certify staging,
security completeness or an entire frozen Masterplan scenario.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SPEC_CASE = re.compile(r"✔\s+(.*?)\s+\(([\d.]+)ms\)")
SUMMARY_PASS = re.compile(r"ℹ pass (\d+)(?:\s|$)")
SUMMARY_FAIL = re.compile(r"ℹ fail (\d+)(?:\s|$)")


def parse_ci_log(raw: str) -> dict:
    """Match test names and pass/fail summary within the SAME job+step."""
    by_step = {}
    for line in raw.splitlines():
        p = line.split("\t", 2)
        if len(p) != 3:
            continue
        job, step, timestamp_message = p
        message = re.sub(r"^\d{4}-\d\d-\d\dT[\d:.]+Z\s*", "", timestamp_message)
        key = (job, step)
        group = by_step.setdefault(key, {"passed_names": set(), "pass_numbers": [], "fail_numbers": []})
        case = SPEC_CASE.search(message)
        if case:
            group["passed_names"].add(case.group(1).strip())
        m = SUMMARY_PASS.search(message)
        if m:
            group["pass_numbers"].append(int(m.group(1)))
        m = SUMMARY_FAIL.search(message)
        if m:
            group["fail_numbers"].append(int(m.group(1)))
    records = []
    summary = {"step_groups": len(by_step), "passed_test_step_groups": 0, "uncertain_groups": 0}
    for (job, step), x in sorted(by_step.items()):
        if not x["passed_names"]:
            continue
        if not x["pass_numbers"] or not x["fail_numbers"] or any(n > 0 for n in x["fail_numbers"]):
            summary["uncertain_groups"] += 1
            continue
        summary["passed_test_step_groups"] += 1
        for name in sorted(x["passed_names"]):
            records.append({"job": job, "step": step, "case_name": name})
    summary["observed_green_case_occurrences"] = len(records)
    return {"summary": summary, "tests": records}


def gh_json(argv: list[str]) -> object:
    cp = subprocess.run(["gh", *argv], cwd=ROOT, text=True, capture_output=True, timeout=90)
    if cp.returncode != 0:
        raise RuntimeError(f"GitHub request failed (status {cp.returncode}): {cp.stderr[:280]}")
    return json.loads(cp.stdout)


def collect_run(run: dict, repo: str) -> dict:
    rid = run["databaseId"]
    cp = subprocess.run(["gh", "run", "view", str(rid), "--repo", repo, "--log"],
                        cwd=ROOT, capture_output=True, text=True, timeout=140)
    if cp.returncode != 0:
        return {"run_id": rid, "name": run["workflowName"], "log_read": "ERROR",
                "error": cp.stderr[:240], "observed": [], "digest_sha256": ""}
    parsed = parse_ci_log(cp.stdout)
    return {"run_id": rid, "name": run["workflowName"], "log_read": "OK",
            "digest_sha256": hashlib.sha256(cp.stdout.encode()).hexdigest(),
            "log_parse": parsed["summary"], "observed": parsed["tests"]}


def capture(repo: str, sha: str, workers: int = 5) -> dict:
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("A full exact SHA is required")
    runs = gh_json(["run", "list", "--repo", repo, "--commit", sha, "--limit", "100",
                    "--json", "databaseId,workflowName,status,conclusion,headSha"])
    if not runs:
        raise ValueError("No exact SHA CI runs")
    incorrect = [x for x in runs if x.get("headSha") != sha or x["status"] != "completed" or x["conclusion"] != "success"]
    if incorrect:
        raise ValueError("Refusing to use non-green/non-exact SHA CI runs")
    parsed = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        promises = [ex.submit(collect_run, run, repo) for run in runs]
        for p in as_completed(promises):
            parsed.append(p.result())
    parsed.sort(key=lambda x: x["run_id"])
    return {
        "source_sha": sha, "repository": repo,
        "github_workflows_successful": len(runs),
        "github_workflows_log_read": sum(x["log_read"] == "OK" for x in parsed),
        "github_workflows_log_unavailable": sum(x["log_read"] != "OK" for x in parsed),
        "case_observation_occurrences_not_deduplicated": sum(len(x["observed"]) for x in parsed),
        "runs": parsed,
        "disclaimer": "Scoped actual GitHub CI passes, not final staging attestation or full Masterplan verification",
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--sha", required=True)
    p.add_argument("--repo", default="itxsam57/hseverify-production-hardening")
    p.add_argument("--output", default=".autopilot/artifacts/QA_PRIOR_EXACT_CI_PASSES.json")
    args = p.parse_args()
    result = capture(args.repo, args.sha)
    path = ROOT / args.output
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "runs"}, indent=2))


if __name__ == "__main__":
    main()
