#!/usr/bin/env python3
"""ZERO: evidence-preserving partial batch receipt from real test runner logs.

Never awards TECH_FULLY_VERIFIED. Human/expert engineering, cybersecurity,
and independent review must later close all gates separately.
"""
from __future__ import annotations
import argparse
import datetime
import hashlib
import json
import re
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs/qa"
ARTIFACTS = ROOT / "artifacts/agency-zero"
APP = "7ff30ea140a5145e5d5ba761f7c7aef24c895269"


def read_json(p):
    return json.loads(p.read_text(encoding="utf-8"))


def save_json(p, value):
    p.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def summary_number(log, name):
    names = re.findall(r"(?m)^(?:ℹ |# )" + re.escape(name) + r" (\d+)\s*$", log)
    return int(names[-1]) if names else None


def save_batch(batch_id):
    manifest = read_json(DOCS / "AGENCY_ZERO_BATCHES.json")
    cursor_path = DOCS / "AGENCY_ZERO_CURSOR.json"
    cursor = read_json(cursor_path)
    evidence_path = DOCS / "AGENCY_ZERO_EVIDENCE.json"
    evidence = read_json(evidence_path)
    candidate = read_json(DOCS / "AGENCY_ZERO_CANDIDATE.json")
    if candidate["source_commit_sha"] != APP or cursor["application_source_sha"] != APP:
        raise ValueError("Pinned source SHA changed; do not silently reset progress")
    if cursor["next_batch_id"] != batch_id:
        raise ValueError(f"Cursor expects {cursor['next_batch_id']}, not {batch_id}")
    matches = [b for b in manifest["batches"] if b["batch_id"] == batch_id]
    if len(matches) != 1:
        raise ValueError("Unknown or duplicate batch ID")
    batch = matches[0]
    if len(batch["units"]) > 5:
        raise ValueError("Batch has more than five original units")
    folder = ARTIFACTS / batch_id
    rows = []
    for l in (folder / "results.tsv").read_text().splitlines():
        parts = l.split("\t")
        if len(parts) not in (3, 4):
            raise ValueError("Malformed selected-case receipt: " + l[:150])
        rows.append(parts)
    ids = [u["scenario_id"] for u in batch["units"]]
    if len(rows) != len(ids) or [r[0] for r in rows] != ids:
        raise ValueError("Missing, extra, duplicate or out-of-order tests")
    selected_paths = [r[2] for r in rows]
    if any(not p.startswith("tests/") or ".." in p for p in selected_paths):
        raise ValueError("Unsafe source-case path")
    preceding_ids = {x["scenario_id"] for x in evidence["technical_attestations"]}
    if any(i in preceding_ids for i in ids):
        raise ValueError("Refusing to overwrite a prior scenario's signed evidence")
    previous_tool_sha = folder / "qa_tooling_sha.txt"
    tooling_sha = previous_tool_sha.read_text().strip() if previous_tool_sha.is_file() else subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", tooling_sha):
        raise ValueError("Invalid tooling head SHA")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    details = []
    for unit, row in zip(batch["units"], rows, strict=True):
        sid, code_string, file = row[:3]
        run_filter = row[3] if len(row) == 4 else None
        log = folder / (sid + ".log")
        if not log.is_file():
            raise ValueError(f"Missing raw log for {sid}")
        raw = log.read_bytes()
        text = raw.decode("utf-8", errors="replace")
        counts = {k: summary_number(text, k) for k in ("tests", "pass", "fail", "skipped")}
        passed = re.findall(r"(?m)^✔ (.+?)(?: \(\d+\.\d+ms\))?\s*$", text)
        failed = re.findall(r"(?m)^✖ (.+?)\s*$", text)
        code = int(code_string)
        has_one_exact_case = code == 0 and counts["pass"] == 1 and counts["fail"] == 0 and len(passed) == 1
        if run_filter is not None and run_filter != "NONE" and has_one_exact_case:
            if not re.search(run_filter, passed[0]):
                has_one_exact_case = False
        status = "SCOPED_PASS_NOT_FULL" if has_one_exact_case else ("TIMEOUT" if code in (124, 137) else ("BLOCKED_TEST_ENVIRONMENT" if code == 125 else "FAIL_OR_UNPROVEN"))
        existing = unit.get("sample_existing_case")
        old_link = bool(existing and existing.get("path") == file)
        details.append({
            "scenario_id": sid, "original_requirement": unit["workflow"], "status": status,
            "selected_file": file, "title": passed[0] if passed else (failed[0] if failed else "NO CONFIRMED TITLE"),
            "original_case_linked": old_link, "test_name_filter": run_filter,
            "exit_code": code, "metrics": counts,
            "log_uri": f"private-workstation:artifacts/agency-zero/{batch_id}/{sid}.log",
            "log_sha256": hashlib.sha256(raw).hexdigest(),
        })
    report = DOCS / f"AGENCY_ZERO_BATCH_{batch_id[-3:]}_REPORT.md"
    report_lines = [
        f"# {batch_id} — {batch['family']} technical evidence",
        "",
        f"**{len(details)} of at most five original related workflow units attempted.** "
        + f"Selected source case results: **{sum(x['status'] == 'SCOPED_PASS_NOT_FULL' for x in details)} PASS**, "
        + f"**{sum(x['status'] != 'SCOPED_PASS_NOT_FULL' for x in details)} FAIL/UNPROVEN**. "
        + "**0 newly TECH FULLY VERIFIED.**",
        "",
        f"Source application SHA: `{APP}`. QA tooling SHA at run: `{tooling_sha}`. "
        + "Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.",
        "",
        "| Original scenario | Selected source test | Outcome |",
        "|---|---|---|",
    ]
    for d in details:
        report_lines.append(f"| `{d['scenario_id']}` | {d['title'].replace('|', '/')} | "
                            f"{'SCOPED PASS' if d['status'] == 'SCOPED_PASS_NOT_FULL' else d['status']} |")
    report_lines += [
        "",
        "## Three discipline reviews — not independent certification",
        "",
        "**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, "
        "with real input/role assertions where present. "
        + ("All selected checks passed." if all(x['status'] == 'SCOPED_PASS_NOT_FULL' for x in details)
           else "At least one check failed or could not be proven; triage from raw log required.")
        + " Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.",
        "",
        "**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the "
        "extent verified in each case source. No entire attack-surface, penetration-scope, independent "
        "replay, security race, provider contract or load assurance is implied. "
        "High/critical vulnerability count for full app: **UNKNOWN**.",
        "",
        "**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original "
        "Masterplan workflow/visual/code independent signoff has **not** been completed. "
        "No claim of accredited third-party review.",
        "",
        "## Outstanding per-case test scope",
        "",
    ]
    for d in details:
        note = ("No direct older source-case link; discovered related case must be mapped/reviewed. "
                if not d["original_case_linked"] else "")
        report_lines.append(f"- `{d['scenario_id']}`: {note}"
                            + ("Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered."
                               if d["status"] == "SCOPED_PASS_NOT_FULL"
                               else f"Investigate selected test result {d['status']} without discarding other evidence."))
    report_lines += ["", "## Raw test evidence (workstation-private; SHA256)", ""]
    for d in details:
        report_lines.append(f"- `{d['scenario_id']}`: `{d['log_uri']}` — "
                            f"SHA256 `{d['log_sha256']}`, selected run exit {d['exit_code']}, "
                            f"TAP {d['metrics']}.")
    report_lines += [
        "",
        "## Exact continuation",
        "",
        "This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; "
        "do not repeat passed scoped tests without a changed candidate or reason. "
        "Continue next separate related batch while the unfinished security and independent reviews "
        "stay in the original unresolved queue.",
        "",
        f"Recorded UTC: {now}",
        "",
    ]
    report.write_text("\n".join(report_lines), encoding="utf-8")
    for d in details:
        sid = d["scenario_id"]
        passed = d["status"] == "SCOPED_PASS_NOT_FULL"
        evidence["technical_attestations"].append({
            "scenario_id": sid, "batch_id": batch_id, "source_sha": APP,
            "qa_tooling_sha": tooling_sha,
            "configuration_fingerprint": hashlib.sha256(
                (batch_id + "|" + APP + "|" + tooling_sha + "|isolated-browser-or-DB-synthetic-fixture").encode()
            ).hexdigest(),
            "observed_at_utc": now,
            "technical_verdict": d["status"],
            "tested_actions": [d["title"]],
            "result_summary": f"{d['status']} ({d['metrics']}); original workflow: {d['original_requirement']}. "
                              "Selected check only; missing applicable full role/security/independent evidence.",
            "gates": {
                "engineering": "PASS" if passed else ("BLOCKED" if d["status"] == "BLOCKED_TEST_ENVIRONMENT" else "FAIL"),
                "functional_workflow": "BLOCKED",
                "ui_accessibility": "BLOCKED",
                "cybersecurity": "BLOCKED",
                "independent_review": "BLOCKED",
                "adapter_contracts": "BLOCKED",
            },
            "open_high_or_critical": None,
            "blocking_defects": [
                "Complete end-to-end scenario and three independent review artifacts not yet signed off",
                "Full manual/adversarial pentest and provider adapter contracts not demonstrated",
            ] if passed else [
                "Selected source test failed, timed out or produced invalid result",
                "Complete end-to-end scenario and expert reviews not yet signed off",
            ],
            "raw_evidence_refs": [
                {"uri": d["log_uri"], "sha256": d["log_sha256"]}
            ],
        })
    save_json(evidence_path, evidence)
    cursor["attempted_batches"].append({
        "batch_id": batch_id,
        "state": "EVIDENCE_RECORDED_INCOMPLETE",
        "report_file": "docs/qa/" + report.name,
        "original_scenario_ids": ids,
        "technical_fully_verified_awarded": 0,
        "scheduled_source_cases_pass": sum(x["status"] == "SCOPED_PASS_NOT_FULL" for x in details),
        "scheduled_source_cases_fail": sum(x["status"] != "SCOPED_PASS_NOT_FULL" for x in details),
        "recorded_utc": now,
    })
    index = [b["batch_id"] for b in manifest["batches"]].index(batch_id)
    cursor["next_batch_id"] = (
        manifest["batches"][index+1]["batch_id"]
        if index + 1 < len(manifest["batches"]) else None
    )
    cursor["revisit_batches"].append(batch_id)
    cursor["next_action"] = (
        f"Advance to {cursor['next_batch_id']} with <=5 related cases; "
        f"revisit unresolved ZERO-001..{batch_id} full security/UI/adapter/independent-review evidence"
    )
    save_json(cursor_path, cursor)
    resume = DOCS / "AGENCY_ZERO_RESUME.md"
    text = resume.read_text(encoding="utf-8")
    line = f"## {batch_id} actually executed\n\n"
    line += f"[Batch report]({report.name}): selected cases "
    line += f"{sum(x['status'] == 'SCOPED_PASS_NOT_FULL' for x in details)}/{len(details)} PASS; "
    line += f"0 technical full. Frozen app SHA {APP[:10]}; full security/role/UI/independent review still pending. "
    line += f"Exact raw hashes in receipt and report. Next {cursor['next_batch_id']}; no prod code changes.\n\n"
    anchor = "## ZERO-006 actual executed batch"
    if anchor not in text:
        raise ValueError("Resume file anchor absent")
    resume.write_text(text.replace(anchor, line+anchor, 1), encoding="utf-8")
    print(f"ZERO | SAVED {batch_id} | SELECTED PASS "
          f"{sum(x['status'] == 'SCOPED_PASS_NOT_FULL' for x in details)}/{len(details)} "
          f"| TECH FULL 0 | NEXT {cursor['next_batch_id']}")
    for item in details:
        print(f"ZERO | {item['scenario_id']} {item['status']}; existing link {item['original_case_linked']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("batch_id")
    args = parser.parse_args()
    if not re.fullmatch(r"ZERO-\d{3}", args.batch_id):
        raise ValueError("Invalid batch ID")
    save_batch(args.batch_id)


if __name__ == "__main__":
    main()
